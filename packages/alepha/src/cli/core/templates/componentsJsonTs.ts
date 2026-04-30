/**
 * `components.json` is the shadcn CLI's project config — it tells
 * `shadcn add` where to drop primitives, which tailwind tokens to use,
 * which icon library to wire up, and which custom registries to resolve.
 *
 * Aliases follow shadcn's defaults (`@/components`, `@/lib/utils`) so the
 * CLI honors them across `init` + `add` calls. Alepha app code lives at
 * `src/web/` (Home, AppRouter, …) and the shadcn primitives live at
 * `src/components/` — kept separate to make the registry components
 * trivially upgradable via `shadcn add --overwrite`.
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
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide",
  "registries": {
    "@alepha": "https://alepha.dev/r/{name}.json"
  }
}
`;
