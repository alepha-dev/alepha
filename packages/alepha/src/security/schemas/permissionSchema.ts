import type { Static } from "alepha";
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

export type Permission = Static<typeof permissionSchema>;
