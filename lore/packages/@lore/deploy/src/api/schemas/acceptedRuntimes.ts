import type { EstateType } from "../entities/estates.ts";

/**
 * The runtimes an estate of this type can run.
 *
 * A property of the TYPE, not of the row: a `bay` runs a Node process, a
 * `cloudflare` account runs a Worker, and nothing an owner can set changes
 * either. It is what epic #1's runtime gate (#1598) refuses an artifact
 * against.
 *
 * ## ⚠️ A module rather than a method, for the reason `defaultAppInstance` is
 *
 * Its two callers are `EstateService`, which is the server, and the Deploy tab,
 * which is a browser and cannot inject a service. A second copy of the mapping
 * in the web layer is how the button comes to offer a deploy the server then
 * refuses - and the refusal would arrive after the operator has already
 * clicked, which is the exact experience objective 6 of #1203 exists to
 * prevent.
 */
export const acceptedRuntimes = (type: EstateType): string[] =>
  type === "bay" ? ["node"] : ["workerd"];
