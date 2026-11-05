import type { Middleware } from "alepha";
import { $page, type PagePrimitive } from "alepha/react/router";

import type { SwaggerExplorerProps } from "./SwaggerExplorer.tsx";

export interface UiSwaggerOptions {
  /**
   * The page's name in the router, for `router.push(name)`.
   *
   * @default "swagger"
   */
  name?: string;

  /**
   * Where the explorer is mounted.
   *
   * @default "/docs"
   */
  path?: string;

  /**
   * Where the OpenAPI document is served: `<prefix>/json` of the app's
   * `$swagger`, or any OpenAPI 3 document the browser may fetch.
   *
   * @default "/docs/json"
   */
  spec?: string;

  /**
   * The browser tab's title.
   *
   * @default "API"
   */
  title?: string;

  /**
   * Middlewares guarding the page, `[$secure({ roles: ["admin"] })]` for an
   * explorer only the team should see. The OpenAPI document itself is served
   * by `$swagger`: guard that route too, or the JSON stays public.
   */
  use?: Middleware[];
}

/**
 * An API explorer page, reading the app's OpenAPI document.
 *
 * `alepha/server/swagger` serves the document only (`$swagger`, at
 * `/docs/json` by default); this is the viewer, built on `@alepha/ui`. It
 * lists the operations by tag with a search, and shows each in full:
 * parameters, request body, responses, their schemas, and what Alepha
 * declared about it (the action, who may call it, middlewares, declared
 * errors, timeout) from the `x-alepha-*` extensions.
 *
 * The page and the document share the `/docs` prefix by default, which is
 * fine: the page is `/docs`, the document `/docs/json`.
 *
 * ```ts
 * import { $swagger } from "alepha/server/swagger";
 * import { $uiSwagger } from "@alepha/ui/swagger";
 *
 * class App {
 *   openapi = $swagger({ info: { title: "Shop API", version: "1.0.0" } });
 *   docs = $uiSwagger();
 * }
 * ```
 *
 * It carries the `$` prefix to sit with the framework's other declarations
 * at a call site, but it is a plain function wrapping `$page`, like
 * `$pageAdmin`. The page component is a lazy chunk, so an app pays for the
 * explorer only when someone opens it.
 */
export const $uiSwagger = (
  options: UiSwaggerOptions = {},
): PagePrimitive<any, SwaggerExplorerProps> => {
  const specUrl = options.spec ?? "/docs/json";
  return $page<any, SwaggerExplorerProps>({
    name: options.name ?? "swagger",
    path: options.path ?? "/docs",
    use: options.use,
    head: { title: options.title ?? "API" },
    props: () => ({ specUrl }),
    lazy: () => import("./SwaggerExplorer.tsx"),
  });
};
