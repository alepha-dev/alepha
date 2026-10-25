import type { Infer } from "alepha";
import { z } from "alepha";

export const permissionSchema = z.object({
  name: z.text({
    description: "Name of the permission.",
  }),

  group: z
    .text({
      description: "Group of the permission.",
    })
    .optional(),

  description: z
    .text({
      description: "Describe the permission.",
    })
    .optional(),

  // Catalogue: what a permission matrix needs to render itself.

  label: z
    .text({
      description:
        "Translation key for this permission's human-readable name. Not the text itself: a matrix built from this registry is rendered in whatever language the reader has chosen.",
    })
    .optional(),

  groupLabel: z
    .text({
      description:
        "Translation key for the GROUP's human-readable name. Declared per permission because a group has no declaration of its own; every permission in one group must agree, and a disagreement is refused when the second one is registered.",
    })
    .optional(),

  groupOrder: z
    .integer()
    .describe(
      "Where this permission's group sits in a matrix. Groups with no order sort last, alphabetically, so an ordered catalogue and an unordered one both read sensibly. Declared per permission for the same reason as groupLabel.",
    )
    .optional(),

  // HTTP Only

  method: z
    .text({
      description: "HTTP method of the permission. When available.",
    })
    .optional(),

  path: z
    .text({
      description: "Pathname of the permission. When available.",
    })
    .optional(),
});

export type Permission = Infer<typeof permissionSchema>;
