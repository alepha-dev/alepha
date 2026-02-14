import type { Static } from "alepha";
import { t } from "alepha";

export const apiActionSchema = t.object({
  path: t.text({
    description: "Pathname used to access the action.",
  }),

  method: t.optional(
    t.text({
      description:
        "HTTP method. Omitted when GET (the default for ~75% of actions).",
    }),
  ),

  body: t.optional(
    t.text({
      description:
        "Reference to a definitions pool entry (e.g. '$0') for the request body JSON Schema.",
    }),
  ),

  response: t.optional(
    t.text({
      description:
        "Reference to a definitions pool entry (e.g. '$0') for the response JSON Schema.",
    }),
  ),

  contentType: t.optional(
    t.text({
      description:
        "Content type for the request body. Only present for non-JSON types (e.g. 'multipart/form-data'). When absent, defaults to application/json.",
    }),
  ),

  service: t.optional(
    t.text({
      description:
        "Service name associated with the action, used for service discovery and routing.",
    }),
  ),
});

export const apiRegistryResponseSchema = t.object({
  prefix: t.optional(t.text()),

  definitions: t.optional(
    t.record(
      t.text(),
      t.string({
        description:
          "Pre-stringified JSON Schema. Values can be 2KB+, so t.string() (no maxLength) is used instead of t.text().",
      }),
    ),
  ),

  actions: t.record(t.text(), apiActionSchema),

  permissions: t.optional(t.array(t.text())),
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
