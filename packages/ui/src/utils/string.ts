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
 * Converts a path or identifier string into a pretty display name.
 * Removes slashes and capitalizes the first letter.
 *
 * @example
 * prettyName("/userName") // "UserName"
 * prettyName("email") // "Email"
 */
export const prettyName = (name: string): string => {
  return capitalize(name.replaceAll("/", ""));
};
