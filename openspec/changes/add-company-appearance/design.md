## Decisions

Store optional appearance by organisation, with atomic first-run setup and owner-only audited later changes. Store the bounded appearance image in PostgreSQL with its settings so backup and reset cover it together. Reuse the existing document logo as an optional source. Serve custom logos only for an organisation already identified by sign-in. Use scoped CSS variables for brand actions and derive readable foregrounds while preserving semantic status and focus styles.
