## ADDED Requirements
### Requirement: Paged document lists
`GET /documents` SHALL accept optional `page` (from 1) and `pageSize` (default 50, at most 200) and SHALL return `total`, the number of matching documents the reader may see. Without them it SHALL return every matching document. Pages SHALL be in a stable order so that no document repeats or is skipped.

#### Scenario: Seven documents, three a page
- **WHEN** HR lists an employee's seven documents three a page
- **THEN** pages 1 to 3 hold 3, 3 and 1 documents, every document once, each page reporting a total of 7
