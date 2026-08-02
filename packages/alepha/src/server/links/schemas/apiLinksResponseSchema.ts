import type { Infer } from "alepha";
import { z } from "alepha";

export const apiActionSchema = z.object({
  path: z.text({
    description: "Pathname used to access the action.",
  }),

  method: z
    .text({
      description:
        "HTTP method. Omitted when GET (the default for ~75% of actions).",
    })
    .optional(),

  contentType: z
    .text({
      description:
        "Content type for the request body. Only present for non-JSON types (e.g. 'multipart/form-data'). When absent, defaults to application/json.",
    })
    .optional(),

  kind: z
    .text({
      description:
        "Action kind. Used to distinguish special action types (e.g. 'sse' for Server-Sent Events streams).",
    })
    .optional(),

  service: z
    .text({
      description:
        "Service name associated with the action, used for service discovery and routing.",
    })
    .optional(),
});

export const apiRegistryResponseSchema = z.object({
  prefix: z.text().optional(),

  actions: z.record(z.text(), apiActionSchema),

  permissions: z.array(z.text()).optional(),

  /**
   * Names of actions that exist on this server but are not callable by the
   * current caller.
   *
   * Without this, a pruned action is indistinguishable from one that was
   * never registered, and the client can only answer "not found" (401) to
   * what is really "not allowed" (403) — so a signed-in user gets bounced
   * to the login page instead of a refusal.
   *
   * Only sent to **authenticated** callers. An anonymous visitor is missing
   * every action, so listing them would leak the whole action registry for
   * nothing: their 401 is already the right answer.
   */
  restricted: z.array(z.text()).optional(),
});

export type ApiRegistryResponse = Infer<typeof apiRegistryResponseSchema>;
export type ApiAction = Infer<typeof apiActionSchema>;
