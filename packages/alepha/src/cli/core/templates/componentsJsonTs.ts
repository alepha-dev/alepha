/**
 * `components.json` is the shadcn CLI's project config — it tells
 * `shadcn add` where to drop primitives, which tailwind tokens to use,
 * which icon library to wire up, and which custom registries to resolve.
 *
 * The aliases below match Alepha's `src/web/` convention (instead of the
 * shadcn default `src/components/`), so `shadcn add` writes into the same
 * tree as Alepha's own CLI scaffolds.
 *
 * The `registries` block pre-wires the public Alepha registry — consumers
 * can immediately run e.g. `shadcn add @alepha/auth-login`.
 */
export const componentsJsonTs = () =>
  `{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/main.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/web/components",
    "utils": "@/web/lib/utils",
    "ui": "@/web/components/ui",
    "lib": "@/web/lib",
    "hooks": "@/web/hooks"
  },
  "iconLibrary": "lucide",
  "registries": {
    "@alepha": "https://alepha.dev/r/{name}.json"
  }
}
`;
