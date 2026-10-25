/**
 * Minimal ambient declaration for the `cloudflare:workers` runtime module.
 *
 * This module only exists inside a Cloudflare Workers isolate — there is no
 * published npm package with its types that we depend on here, and adding one
 * would pull a runtime dependency into `alepha` just to satisfy `tsc`. This
 * declares just enough of the surface `AlephaWebSocketDurableObject.ts` needs
 * so typecheck passes; it is never imported by test code (`cloudflare:workers`
 * does not exist under Vitest) — only reached via the generated workerd entry
 * point.
 */
declare module "cloudflare:workers" {
  export class DurableObject<Env = Record<string, unknown>> {
    ctx: any;
    env: Env;
    constructor(ctx: any, env: Env);
  }
}
