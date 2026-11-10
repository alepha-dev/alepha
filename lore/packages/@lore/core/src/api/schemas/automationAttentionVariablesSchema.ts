import { z } from "alepha";

/**
 * What the "your automation needs you" inbox message is rendered from.
 */
export const automationAttentionVariablesSchema = z.object({
  automationTitle: z.string().max(255),
  /**
   * `approval`: paused until its author reviews it. `broken`: something it
   * depends on is gone.
   */
  kind: z.enum(["approval", "broken"]),
  /**
   * The rule's stored reason, which is a sentence Lore wrote and never a
   * driver's error.
   */
  reason: z.string().max(1024),
  projectTitle: z.string().max(255),
  /**
   * The rule's page, relative to the app root.
   */
  href: z.string().max(2048),
  /**
   * The opaque partition, `project:<id>`.
   */
  scope: z.string().max(64),
});
