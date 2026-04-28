/**
 * Capitalizes the first letter of a string.
 *
 * @example
 * capitalize("hello") // "Hello"
 */
export const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Converts camelCase or snake_case to Title Case with spaces.
 *
 * @example
 * toTitleCase("userName") // "User Name"
 * toTitleCase("first_name") // "First Name"
 * toTitleCase("email") // "Email"
 */
export const toTitleCase = (str: string): string => {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .replace(/_/g, " ") // snake_case -> snake case
    .replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize words
};

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
  // Split by slash and filter out empty strings and numeric indices
  const segments = name.split("/").filter((s) => s && !/^\d+$/.test(s));

  // Use the last non-numeric segment as the field name
  const fieldName = segments[segments.length - 1] || name.replaceAll("/", "");

  return toTitleCase(fieldName);
};
