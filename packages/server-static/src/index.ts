import { __bind } from "@alepha/core";
import { $serve } from "./descriptors/$serve.ts";
import { ServerStaticProvider } from "./providers/ServerStaticProvider.ts";

export * from "./descriptors/$serve.ts";
export * from "./providers/ServerStaticProvider.ts";

__bind($serve, ServerStaticProvider);
