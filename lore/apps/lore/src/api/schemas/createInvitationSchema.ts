import type { Static } from "alepha";
import { z } from "alepha";

export const createInvitationSchema = z.object({
  email: z.string().meta({ format: "email" }),
  resourceType: z.text({ minLength: 1, maxLength: 100 }),
  resourceId: z.text({ minLength: 1, maxLength: 255 }),
  roles: z.array(z.text()).optional(),
  metadata: z.record(z.text(), z.any()).optional(),
});

export type CreateInvitation = Static<typeof createInvitationSchema>;
