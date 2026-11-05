import { $swagger } from "alepha/server/swagger";

/**
 * The OpenAPI document of the showcase's own actions, at `/docs/json`: what
 * the API explorer page reads. Every `Showcase*Controller` lands in it, with
 * the `x-alepha-*` metadata the explorer shows.
 */
export class ShowcaseOpenApi {
  openapi = $swagger({
    info: {
      title: "Alepha UI showcase",
      version: "1.0.0",
      description:
        "The actions behind the showcase pages: fixtures standing in for the real `alepha/api/*` controllers.",
    },
  });
}
