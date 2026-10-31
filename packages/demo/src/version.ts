/**
 * Bump when the seed changes. The demo's data version is this plus a hash of core's migrations
 * (apps/demo/scripts/data-version.ts), so a deploy with a new seed or a new migration gives
 * every visitor a fresh database automatically; other deploys keep their data.
 */
export const SEED_VERSION = "2026-10-31.1";
