import { type Infer, z } from "alepha";

/**
 * The optional infrastructure provider for project scaffolding.
 *
 * `cloudflare` (or `cf`) generates an explicit Cloudflare descriptor. `lore`
 * generates a `lore({ project })` environment from `@alepha/lore/cli`, the
 * adapter that builds what the estate runs and deploys it through Lore: the
 * framework gains no dependency on Lore, only the generated project imports
 * it.
 */
export const infraProviderSchema = z
  .enum(["cloudflare", "cf", "lore"])
  .transform((value): "cloudflare" | "lore" =>
    value === "lore" ? "lore" : "cloudflare",
  )
  .describe(
    "Configure production infrastructure: cloudflare (or cf), or lore to deploy through Lore",
  );

export type InfraProvider = Infer<typeof infraProviderSchema>;
