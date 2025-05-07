import { __bind } from "@alepha/core";
import { $swagger } from "./descriptors/$swagger.ts";
import { ServerSwaggerProvider } from "./providers/ServerSwaggerProvider.ts";

export * from "./descriptors/$swagger.ts";
export * from "./providers/ServerSwaggerProvider.ts";

__bind($swagger, ServerSwaggerProvider);
