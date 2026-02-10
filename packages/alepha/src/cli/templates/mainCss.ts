export const mainCss = (opts: { ui?: boolean; tailwind?: boolean } = {}) => {
  if (opts.ui) {
    return `/**
 * Alepha UI - Based on Mantine component library
 * Mantine Docs: https://mantine.dev
 * Mantine LLM context: https://mantine.dev/llms.txt
 *
 * Switch theme index: alepha.set(alephaThemeAtom, { index: 1 })
 *
 * Custom themes (in src/web/index.ts):
 *
 *   import { alephaThemeListAtom } from "@alepha/ui";
 *
 *   export const WebModule = $module({
 *     name: "app.web",
 *     services: [AppRouter],
 *     register(alepha) {
 *       alepha.register(AppRouter);
 *       alepha.set(alephaThemeListAtom, [{
 *         name: "My Theme",
 *         description: "Custom theme",
 *         primaryColor: "blue",
 *         defaultColorScheme: "dark",
 *         // ...MantineThemeOverride options
 *       }]);
 *     },
 *   });
 *
 * Alternatives (remove the import below):
 * - Tailwind CSS: https://tailwindcss.com/docs/installation/using-vite
 * - Raw CSS: Write your own styles
 */
@import "@alepha/ui/styles";`;
  }

  if (opts.tailwind) {
    return `@import "tailwindcss";

/* Add your styles here */
`;
  }

  return `/**
 * Global styles for your application.
 *
 * Options:
 * - @alepha/ui: Use \`alepha init --ui\` to add Mantine-based components
 * - Tailwind CSS: Use \`alepha init --tailwind\` to add Tailwind CSS
 * - Raw CSS: Write your own styles below
 */

/* Add your styles here */
`;
};
