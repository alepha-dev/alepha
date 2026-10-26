import { $error, z } from "alepha";

/**
 * A failure of the AI layer: a vendor refusing a request, a configuration
 * that cannot work, a stream that broke.
 *
 * Every more specific AI error extends it, so `instanceof AiError` catches
 * the whole family. `provider` names the vendor provider that raised it and
 * `status` the HTTP status the vendor answered, when there was one.
 */
export const AiError = $error({
  name: "AI",
  schema: z.object({
    provider: z.text().optional(),
    status: z.number().optional(),
  }),
  message: "The AI provider failed",
});

export type AiError = InstanceType<typeof AiError>;
