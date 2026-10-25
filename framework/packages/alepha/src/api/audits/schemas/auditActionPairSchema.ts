import { type Infer, z } from "alepha";

/**
 * One `(type, action)` pair a registered `$audit` type declares.
 *
 * An action name only means something inside its type: `create` is a user in
 * one audit row and a parameter version in another. The admin filter offers
 * these pairs rather than bare action names for that reason (feedback #2049).
 */
export const auditActionPairSchema = z.object({
  type: z.text({ description: "The audit type the action belongs to" }),
  action: z.text({ description: "The action name, unique within its type" }),
});

export type AuditActionPair = Infer<typeof auditActionPairSchema>;
