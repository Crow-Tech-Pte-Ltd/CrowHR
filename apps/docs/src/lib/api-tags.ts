/** URL slug for an OpenAPI tag: "Members and roles" → "members-and-roles". */
export function apiTagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
