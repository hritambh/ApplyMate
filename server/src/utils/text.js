/**
 * Capitalize the first letter of a string and lowercase the rest.
 * e.g. "admin" -> "Admin", "ADMIN" -> "Admin".
 */
export function capitalizeFirstLetter(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Capitalize a person's name, word by word, so multi-word names are handled
 * correctly. e.g. "john doe" -> "John Doe", "admin" -> "Admin".
 * Whitespace between words is collapsed to single spaces.
 */
export function capitalizeName(name) {
  if (!name) return name;
  return String(name)
    .trim()
    .split(/\s+/)
    .map(capitalizeFirstLetter)
    .join(' ');
}
