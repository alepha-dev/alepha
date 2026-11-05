/**
 * The API explorer.
 *
 * `$uiSwagger` mounts a page that reads the app's OpenAPI document (served by
 * `$swagger` from `alepha/server/swagger`) and renders it with `@alepha/ui`:
 * operations by tag with a search, each in full with its schemas and the
 * `x-alepha-*` metadata Alepha adds. The components are exported too, for an
 * app that lays the explorer out itself.
 *
 * @module alepha.ui.swagger
 */

export { $uiSwagger, type UiSwaggerOptions } from "./$uiSwagger.tsx";
export {
  OpenApiSpec,
  type SwaggerAlephaMetadata,
  type SwaggerEntry,
  type SwaggerGroup,
  type SwaggerSecurity,
} from "./OpenApiSpec.ts";
export {
  SwaggerAlephaMeta,
  type SwaggerAlephaMetaProps,
} from "./SwaggerAlephaMeta.tsx";
export {
  SwaggerExplorer,
  type SwaggerExplorerProps,
} from "./SwaggerExplorer.tsx";
export {
  SwaggerMethodBadge,
  type SwaggerMethodBadgeProps,
} from "./SwaggerMethodBadge.tsx";
export { SwaggerNav, type SwaggerNavProps } from "./SwaggerNav.tsx";
export {
  SwaggerOperationView,
  type SwaggerOperationViewProps,
} from "./SwaggerOperationView.tsx";
export {
  SwaggerParameters,
  type SwaggerParametersProps,
} from "./SwaggerParameters.tsx";
export {
  SwaggerResponses,
  type SwaggerResponsesProps,
} from "./SwaggerResponses.tsx";
export {
  SwaggerSchemaView,
  type SwaggerSchemaViewProps,
} from "./SwaggerSchemaView.tsx";
