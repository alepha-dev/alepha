export const mainCss = (opts: { tailwind?: boolean } = {}) => {
  if (opts.tailwind) {
    return `@import "tailwindcss";

/* Add your styles here */
`;
  }

  return `/**
 * Global styles for your application.
 *
 * Options:
 * - Tailwind CSS: Use \`alepha init --tailwind\` to add Tailwind CSS
 * - Raw CSS: Write your own styles below
 */

/* Add your styles here */
`;
};
