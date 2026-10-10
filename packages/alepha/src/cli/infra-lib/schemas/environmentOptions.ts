import { type Infer, z } from "alepha";

/**
 * The options every adapter that attaches a host shares: `cloudflare()` and
 * `bay()` spread it, and `WorkerCloudflareAdapter` reads nothing else.
 */
export const environmentOptionsSchema = z.object({
  /**
   * Custom domain for the deployed app (e.g. "api.example.com").
   *
   * On Cloudflare this is attached as a Custom Domain; on Bay it is
   * registered with the app, which answers ACME for it.
   *
   * Omit it and a Cloudflare Worker answers on
   * `<script>.<subdomain>.workers.dev` instead, where `<subdomain>` is the
   * one your Cloudflare account registered: the build writes `workers_dev:
   * true`, the deploy enables it, and the address comes back as the deploy's
   * URL. Setting a domain writes `workers_dev: false`, so an app that gains
   * one stops answering on the host it used to be reachable at.
   *
   * Always a plain host. A wildcard (`*.example.com`) is refused: a Custom
   * Domain cannot be one, Bay cannot prove one over ACME, and a multi-tenant
   * app on wildcard hosts deploys through Lore Deploy.
   */
  domain: z
    .text()
    .refine((it) => !it.includes("*"), {
      message:
        "A wildcard domain is refused: neither a Cloudflare Custom Domain nor a Bay certificate can be one. Use a plain host, or deploy a multi-tenant app through Lore Deploy.",
    })
    .optional(),
});

export type EnvironmentOptions = Infer<typeof environmentOptionsSchema>;
