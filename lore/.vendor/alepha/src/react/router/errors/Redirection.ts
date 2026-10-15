import { $error, z } from "alepha";

/**
 * Thrown (or returned) by a page's loader or resolver to send the visitor
 * elsewhere: the router answers with a redirect to `data.redirect`.
 *
 * ```ts
 * throw new Redirection({ redirect: "/new-path" });
 * ```
 */
export const Redirection = $error({
  name: "REDIRECTION",
  schema: z.object({ redirect: z.text({ size: "long" }) }),
  message: "Redirection",
});

export type Redirection = InstanceType<typeof Redirection>;
