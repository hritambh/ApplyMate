/** Normalize company + role so multiple HR rows merge into one application group. */
export function groupKey(company, role) {
  return `${String(company).trim().toLowerCase()}::${String(role).trim().toLowerCase()}`;
}
