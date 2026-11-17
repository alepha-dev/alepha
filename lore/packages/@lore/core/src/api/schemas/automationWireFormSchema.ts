import { z } from "alepha";

/**
 * Wiring by keyboard from a node's inspector (#Q3811): the port the wire
 * leaves by and the node it goes to, `<port>:<node>`.
 */
export const automationWireFormSchema = z.object({
  target: z.string().max(140).optional(),
});
