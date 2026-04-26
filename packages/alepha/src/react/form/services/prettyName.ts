/**
 * Converts a path or identifier string into a pretty display name.
 * For paths like "/contacts/0/name", extracts just the field name "Name".
 * Handles camelCase and snake_case conversion to Title Case.
 *
 * @example
 * prettyName("/userName") // "User Name"
 * prettyName("/contacts/0/email") // "Email"
 * prettyName("/address/streetName") // "Street Name"
 * prettyName("first_name") // "First Name"
 */
export const prettyName = (name: string): string => {
  const segments = name.split("/").filter((s) => s && !/^\d+$/.test(s));
  const fieldName = segments[segments.length - 1] || name.replaceAll("/", "");
  return fieldName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};
