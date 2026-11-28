import { createHash } from "node:crypto";
import { type AdapterFactory, type AdapterPayload, errors } from "oidc-provider";

type Query = <Row extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  parameters?: unknown[],
) => Promise<{ rows: Row[] }>;

interface AttemptKey {
  state: string;
  interaction: string;
  client: string;
}

const ATTEMPT_LIFETIME_SECONDS = 600;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Standalone issuer protocol state. Each service environment has separate credentials and state. */
export function createStorage(query: Query, issuer: string) {
  const adapter: AdapterFactory = (model) => {
    async function find(id: string): Promise<AdapterPayload | undefined> {
      const result = await query<{ payload: AdapterPayload }>(
        "SELECT payload FROM managed_login_objects WHERE issuer = $1 AND model = $2 AND id = $3 AND expires_at > now()",
        [issuer, model, hash(id)],
      );
      return result.rows[0]?.payload;
    }

    const findBy = async (field: "uid" | "userCode", value: string) => {
      const result = await query<{ payload: AdapterPayload }>(
        "SELECT payload FROM managed_login_objects WHERE issuer = $1 AND model = $2 AND payload ->> $3 = $4 AND expires_at > now()",
        [issuer, model, field, value],
      );
      return result.rows[0]?.payload;
    };

    return {
      async upsert(id, payload, expiresIn = ATTEMPT_LIFETIME_SECONDS) {
        await query(
          `INSERT INTO managed_login_objects(issuer, model, id, payload, expires_at)
           VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')
           ON CONFLICT (issuer, model, id) DO UPDATE
             SET payload = excluded.payload, expires_at = excluded.expires_at`,
          [issuer, model, hash(id), JSON.stringify(payload), expiresIn],
        );
      },
      find,
      findByUserCode: (value) => findBy("userCode", value),
      findByUid: (value) => findBy("uid", value),
      async consume(id) {
        const { rows } = await query(
          `UPDATE managed_login_objects SET payload = jsonb_set(payload, '{consumed}', to_jsonb(floor(extract(epoch from now()))))
           WHERE issuer = $1 AND model = $2 AND id = $3 AND expires_at > now() AND NOT (payload ? 'consumed')
           RETURNING id`,
          [issuer, model, hash(id)],
        );
        if (rows.length !== 1) throw new errors.InvalidGrant();
      },
      async destroy(id) {
        await query("DELETE FROM managed_login_objects WHERE issuer = $1 AND model = $2 AND id = $3", [
          issuer,
          model,
          hash(id),
        ]);
      },
      async revokeByGrantId(grantId) {
        await query(
          "DELETE FROM managed_login_objects WHERE issuer = $1 AND model = $2 AND payload ->> 'grantId' = $3",
          [issuer, model, grantId],
        );
      },
    };
  };

  return {
    adapter,
    async initialise() {
      const schema = `
        CREATE TABLE IF NOT EXISTS managed_login_objects (
          issuer text NOT NULL,
          model text NOT NULL,
          id text NOT NULL,
          payload jsonb NOT NULL,
          expires_at timestamptz NOT NULL,
          PRIMARY KEY (issuer, model, id)
        );
        CREATE INDEX IF NOT EXISTS managed_login_object_expiry ON managed_login_objects (issuer, expires_at);
        CREATE INDEX IF NOT EXISTS managed_login_object_uid ON managed_login_objects (issuer, model, (payload->>'uid'));
        CREATE INDEX IF NOT EXISTS managed_login_object_grant ON managed_login_objects (issuer, model, (payload->>'grantId'));
        CREATE TABLE IF NOT EXISTS managed_login_attempts (
          issuer text NOT NULL,
          interaction text NOT NULL,
          client text NOT NULL,
          state_digest text NOT NULL,
          sealed text NOT NULL,
          expires_at timestamptz NOT NULL,
          PRIMARY KEY (issuer, interaction)
        );
        CREATE INDEX IF NOT EXISTS managed_login_attempt_expiry ON managed_login_attempts (issuer, expires_at);
      `;
      for (const statement of schema
        .split(";")
        .map((sql) => sql.trim())
        .filter(Boolean))
        await query(statement);
    },
    async saveAttempt(attempt: AttemptKey & { sealed: string }) {
      await query(
        `INSERT INTO managed_login_attempts(issuer, interaction, client, state_digest, sealed, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + $6 * interval '1 second')
         ON CONFLICT (issuer, interaction) DO UPDATE
           SET client = excluded.client, state_digest = excluded.state_digest, sealed = excluded.sealed,
               expires_at = excluded.expires_at`,
        [issuer, attempt.interaction, attempt.client, hash(attempt.state), attempt.sealed, ATTEMPT_LIFETIME_SECONDS],
      );
    },
    async takeAttempt(attempt: AttemptKey) {
      const { rows } = await query<{ sealed: string }>(
        `DELETE FROM managed_login_attempts
         WHERE issuer = $1 AND interaction = $2 AND client = $3 AND state_digest = $4 AND expires_at > now()
         RETURNING sealed`,
        [issuer, attempt.interaction, attempt.client, hash(attempt.state)],
      );
      return rows[0]?.sealed;
    },
    async sweep() {
      await query("DELETE FROM managed_login_objects WHERE issuer = $1 AND expires_at <= now()", [issuer]);
      await query("DELETE FROM managed_login_attempts WHERE issuer = $1 AND expires_at <= now()", [issuer]);
    },
  };
}

export type BrokerStorage = ReturnType<typeof createStorage>;
