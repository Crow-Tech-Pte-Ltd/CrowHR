/**
 * Entry point for hosts that seed fictional data through the real services (the browser demo,
 * `@crowhr/core/seed`). Runtime-agnostic: everything here also runs in a browser worker.
 * Not for production hosts: nothing here belongs in apps/server.
 */
export { buildActor } from "../employees/access.ts";
export { applyEvent, ctxFor, hire } from "../employees/lifecycle.ts";
export { nricCheckLetter } from "../employees/nric.ts";
export { defaultPeoplePorts } from "../employees/ports.ts";
export { setBankAccount } from "../employees/profile.ts";
export { createStructure } from "../organisation/structure.ts";
export { SEED_PEOPLE, type SeededPeople, seedContactName, seedPeople } from "./seed-people.ts";
