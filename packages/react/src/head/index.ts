import {
  AlephaReact,
  type PageConfigSchema,
  type TPropsDefault,
  type TPropsParentDefault,
} from "@alepha/react";
import { $module } from "alepha";
import { $head } from "./primitives/$head.ts";
import type { Head } from "./interfaces/Head.ts";
import { ServerHeadProvider } from "./providers/ServerHeadProvider.ts";
import { HeadProvider } from "./providers/HeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$head.ts";
export * from "./hooks/useHead.ts";
export * from "./interfaces/Head.ts";
export * from "./helpers/SeoExpander.ts";
export * from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/react" {
  interface PagePrimitiveOptions<
    TConfig extends PageConfigSchema = PageConfigSchema,
    TProps extends object = TPropsDefault,
    TPropsParent extends object = TPropsParentDefault,
  > {
    head?: Head | ((props: TProps, previous?: Head) => Head);
  }

  interface ReactRouterState {
    head: Head;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Fill `<head>` server & client side.
 *
 * @see {@link ServerHeadProvider}
 * @module alepha.react.head
 */
export const AlephaReactHead = $module({
  name: "alepha.react.head",
  primitives: [$head],
  services: [AlephaReact, ServerHeadProvider, HeadProvider],
});
