import { __bind } from "@alepha/core";
import { $swagger } from "./descriptors/$swagger.ts";
import { ServerSwaggerProvider } from "./ServerSwaggerProvider.ts";

export * from "./descriptors/$swagger.ts";
export * from "./ServerSwaggerProvider.ts";

__bind($swagger, ServerSwaggerProvider);
