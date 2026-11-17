import { z } from "alepha";

/**
 * A node's id, unique in its graph. Steps, receipts and occurrence
 * identities are keyed by it, and a bell's merged nodes are
 * `<presetKey>.<nodeId>`, so it holds dots.
 */
export const automationGraphNodeIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, {
    message:
      "A node id is 1 to 64 lowercase letters, digits, '.', '_' or '-', starting with a letter or digit",
  });
