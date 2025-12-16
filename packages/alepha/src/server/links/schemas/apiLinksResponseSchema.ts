import type { Static } from "alepha";
import { t } from "alepha";

export const apiLinkSchema = t.object({
  name: t.text({
    description: "Name of the API link, used for identification.",
  }),

  group: t.optional(
    t.text({
      description:
        "Group to which the API link belongs, used for categorization.",
    }),
  ),

  path: t.text({
    description: "Pathname used to access the API link.",
  }),

  method: t.optional(
    t.text({
      description:
        "HTTP method used for the API link, e.g., GET, POST, etc. If not specified, defaults to GET.",
    }),
  ),

  requestBodyType: t.optional(
    t.text({
      description:
        "Type of the request body for the API link. Default is application/json for POST/PUT/PATCH, null for others.",
    }),
  ),

  service: t.optional(
    t.text({
      description:
        "Service name associated with the API link, used for service discovery.",
    }),
  ),
});

export const apiLinksResponseSchema = t.object({
  prefix: t.optional(t.text()),
  links: t.array(apiLinkSchema),
});

export type ApiLinksResponse = Static<typeof apiLinksResponseSchema>;
export type ApiLink = Static<typeof apiLinkSchema>;
