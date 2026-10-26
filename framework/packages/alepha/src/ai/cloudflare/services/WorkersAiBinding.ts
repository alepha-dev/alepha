import { $env, z } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  AI_BINDING: z.text({
    default: "AI",
    secret: false,
    description:
      "Name of the Workers AI binding (env.AI) the Workers AI provider calls. The Cloudflare build declares it under this name.",
  }),
  AI_GATEWAY_ID: z
    .text({
      secret: false,
      description:
        "Optional Cloudflare AI Gateway id the binding routes its calls through, for logs, caching and rate limits.",
    })
    .optional(),
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The Workers AI binding an app declares by registering `AlephaAiCloudflare`.
 *
 * Registered on every runtime, unlike `WorkersAiProvider`: the Cloudflare
 * build runs on Node and finds it by `id` to emit the `ai` binding, while
 * the provider itself (and `alepha/ai`, whose default it would otherwise
 * fix) is only registered on Workers. It imports nothing from `alepha/ai` on
 * purpose, so registering it off Workers leaves the provider choice to the
 * vendor modules registered after it.
 */
export class WorkersAiBinding {
  public static readonly id: string = "alepha.ai.WorkersAiBinding";

  protected readonly env = $env(envSchema);

  /**
   * The binding name, `AI` unless `AI_BINDING` says otherwise.
   */
  public get bindingName(): string {
    return this.env.AI_BINDING;
  }

  /**
   * The AI Gateway the binding routes through, when `AI_GATEWAY_ID` is set.
   */
  public get gatewayId(): string | undefined {
    return this.env.AI_GATEWAY_ID || undefined;
  }
}
