/**
 * Seeds the e2e database before the server starts (run by playwright.config.ts). Uses the same
 * migrations, schema and argon2id hasher as the server, so the app under test has no seeding
 * backdoor. Idempotent: CI retries reuse the database.
 */
// Relative imports: the repo root has no workspace links (bun's isolated installs).

import { createArgon2Hasher } from "../apps/server/src/argon2-hasher.ts";
import { openDatabase } from "../apps/server/src/db.ts";
import { createUuidV7Generator, schema, systemClock } from "../packages/core/src/index.ts";
import { seedMember } from "../packages/core/testing/fixtures.ts";
import { E2E } from "./fixtures.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const database = await openDatabase(url);
await database.migrate();
const db = database.db;
const ids = createUuidV7Generator(systemClock);
const deps = { db, ids, clock: systemClock, passwordHasher: createArgon2Hasher({ memoryCost: 4096, timeCost: 1 }) };

const existing = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.org.slug);
if (!existing) {
  const orgId = ids.newId();
  await db
    .insert(schema.organisations)
    .values({ id: orgId, name: E2E.org.name, slug: E2E.org.slug, uen: "202600001K" });
  await db.insert(schema.orgSecuritySettings).values({ orgId });
  for (const m of Object.values(E2E.members)) {
    // biome-ignore lint/suspicious/noExplicitAny: seedMember only needs db/ids/clock/passwordHasher.
    await seedMember(deps as any, orgId, {
      email: m.email,
      displayName: m.name,
      password: E2E.password,
      roles: [...m.roles],
    });
  }
  console.error(`Seeded ${E2E.org.name} with ${Object.keys(E2E.members).length} members.`);
}
await database.close();
