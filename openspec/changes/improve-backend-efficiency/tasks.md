## Implementation

- [x] 1. Batch core payroll writes and verify replacement across multiple batches using payroll workflow tests and the PostgreSQL benchmark.
- [x] 2. Optimise core attendance and leave report reads, including database paging, and run attendance and reporting scope and export tests.
- [x] 3. Bound core OIDC cache and expire transaction rows with an indexed sweep. Run SSO, scheduler and migration tests.
- [x] 4. Extend the development benchmark for isolated PostgreSQL and a sustained mixed workload. Run and record a before-and-after comparison and verify a short resource sampling run.

Publish and verify the demo and docs using `docs/deploy-demo.md` after merge.
