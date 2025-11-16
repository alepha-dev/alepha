import type { Static } from "alepha";
import { t } from "alepha";

export const permissionSchema = t.object({
  name: t.text({
    description: "Name of the permission.",
  }),

  group: t.optional(
    t.text({
      description: "Group of the permission.",
    }),
  ),

  description: t.optional(
    t.text({
      description: "Describe the permission.",
    }),
  ),

  // HTTP Only

  method: t.optional(
    t.text({
      description: "HTTP method of the permission. When available.",
    }),
  ),

  path: t.optional(
    t.text({
      description: "Pathname of the permission. When available.",
    }),
  ),
});

export type Permission = Static<typeof permissionSchema>;
