export interface MainCssOptions {
  /**
   * Import `@alepha/ui`'s stylesheet instead of Tailwind directly.
   *
   * The two are not additive: `@alepha/ui/styles.css` opens with
   * `@import "tailwindcss"` and follows it with the shadcn layer, the font
   * faces, the `@source` glob that makes Tailwind scan the component sources,
   * and the theme tokens the components read. Importing `tailwindcss` again
   * beside it is a duplicate, not a safety net.
   */
  ui?: boolean;
}

export const mainCss = (options: MainCssOptions = {}) => {
  if (options.ui) {
    return `@import "@alepha/ui/styles.css";

/* Add your styles here */
`;
  }

  return `@import "tailwindcss";

/* Add your styles here */
`;
};
