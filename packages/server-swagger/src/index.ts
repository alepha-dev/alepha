import { __bind } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $swagger } from "./descriptors/$swagger.ts";
import { ServerSwaggerProvider } from "./ServerSwaggerProvider.ts";

export * from "./descriptors/$swagger.ts";
export * from "./ServerSwaggerProvider.ts";

__bind($swagger, AlephaServer);
__bind($swagger, ServerSwaggerProvider);
