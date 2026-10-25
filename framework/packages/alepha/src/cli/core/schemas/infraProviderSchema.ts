import { type Infer, z } from "alepha";

/**
 * The optional infrastructure provider for project scaffolding.
 * Both public spellings generate the same explicit Cloudflare descriptor.
 */
export const infraProviderSchema = z
  .enum(["cloudflare", "cf"])
  .transform((): "cloudflare" => "cloudflare")
  .describe(
    "Configure Cloudflare production infrastructure (cloudflare or cf)",
  );

export type InfraProvider = Infer<typeof infraProviderSchema>;
