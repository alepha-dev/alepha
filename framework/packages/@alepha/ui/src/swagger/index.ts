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
  SwaggerAccessBadge,
  type SwaggerAccessBadgeProps,
} from "./SwaggerAccessBadge.tsx";
export {
  SwaggerAlephaMeta,
  type SwaggerAlephaMetaProps,
} from "./SwaggerAlephaMeta.tsx";
export {
  SwaggerCredentials,
  type SwaggerCredentialsProps,
} from "./SwaggerCredentials.tsx";
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
  type SwaggerBodyMode,
  type SwaggerFieldTarget,
  type SwaggerRequest,
  SwaggerRequestBuilder,
  type SwaggerRequestModel,
} from "./SwaggerRequestBuilder.ts";
export {
  type SwaggerResponseResult,
  SwaggerResponseView,
  type SwaggerResponseViewProps,
} from "./SwaggerResponseView.tsx";
export { SwaggerTryIt, type SwaggerTryItProps } from "./SwaggerTryIt.tsx";
export {
  SwaggerTryItForm,
  type SwaggerTryItFormProps,
} from "./SwaggerTryItForm.tsx";
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
export { type SwaggerAccess, useSwaggerAccess } from "./useSwaggerAccess.ts";
