import {
  createDemoPasswordHasher,
  type Db,
  type DemoProvisionInput,
  type FileStore,
  type Logger,
  noopLogger,
} from "@crowhr/core";
import { demoCompanyEmailDomain } from "./demo-personas.ts";
import { installSampleCompany, prepareSampleCompany } from "./seed.ts";

/**
 * Demo companies on a server (openspec add-demo-companies): each visitor's private copy of the
 * sample company Kopi Kaki. The server (apps/server) wires `createDemoCompanyProvisioner` into
 * core's `deps.demoCompanies.provision`; core decides when to seed and hands copies out.
 */

export { demoCompanyEmailDomain, demoCompanyPersonaInfo } from "./demo-personas.ts";

export interface DemoCompanyProvisionerInput {
  /** The server's database and file storage, where each copy lands. */
  target: Db;
  fileStore: FileStore;
  /** The server's encryption key, so it can read the copy's NRIC and bank fields. */
  secretKey: Uint8Array;
  publicUrl: string;
  /** An empty, migrated scratch database for one seed, closed afterwards (in-memory PGlite). */
  openScratch: () => Promise<{ db: Db; close(): Promise<void> }>;
  logger?: Logger;
}

/**
 * Seeds one demo company per call: Kopi Kaki's history in a scratch database (the sweeps there run
 * with a seed clock, which must never touch the server's other organisations), brought up to
 * `now`, with no passwords, then copied into the server in one transaction with the demo flag set
 * on insert. The organisation's UEN is left empty (`organisations.uen` is unique on the server).
 */
export function createDemoCompanyProvisioner(input: DemoCompanyProvisionerInput) {
  return async ({ slug, expiresAt, claimedAt, now }: DemoProvisionInput): Promise<{ orgId: string }> => {
    const scratch = await input.openScratch();
    try {
      const prepared = await prepareSampleCompany({
        scratch: scratch.db,
        secretKey: input.secretKey,
        // Only for the scratch seed, whose accounts end with no password at all (passwords: none);
        // never the server's hasher, so nothing seeded could sign in on the server with one.
        passwordHasher: createDemoPasswordHasher(),
        publicUrl: input.publicUrl,
        now,
        logger: input.logger ?? noopLogger,
        org: { slug, emailDomain: demoCompanyEmailDomain(slug) },
        passwords: "none",
      });
      await installSampleCompany(prepared, input.target, input.fileStore, {
        organisation: { slug, uen: null, demoExpiresAt: expiresAt, demoClaimedAt: claimedAt },
      });
      return { orgId: prepared.orgId };
    } finally {
      await scratch.close().catch(() => undefined);
    }
  };
}
