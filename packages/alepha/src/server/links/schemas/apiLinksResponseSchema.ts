import type { Static } from "alepha";
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
});

export type ApiRegistryResponse = Static<typeof apiRegistryResponseSchema>;
export type ApiAction = Static<typeof apiActionSchema>;

/**
 * @deprecated Use `apiRegistryResponseSchema` and `ApiRegistryResponse` instead.
 */
export const apiLinksResponseSchema = apiRegistryResponseSchema;

/**
 * @deprecated Use `ApiRegistryResponse` instead.
 */
export type ApiLinksResponse = ApiRegistryResponse;

/**
 * @deprecated Use `ApiAction` instead.
 */
export type ApiLink = ApiAction;
