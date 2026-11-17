import { type Infer, z } from "alepha";

import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * A preset's graph as its card draws it (#Q3812): each node's kind and
 * place from `AutomationGraph.layout`, and the wires between them. Shape
 * only: no node's configuration leaves the server this way.
 */
export const automationPresetSketchSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().max(64),
            kind: z.enum(AutomationVocabulary.KINDS),
            x: z.number(),
            y: z.number(),
          })
          .strict(),
      )
      .max(40),
    edges: z
      .array(
        z.object({ from: z.string().max(64), to: z.string().max(64) }).strict(),
      )
      .max(80),
  })
  .strict();
export type AutomationPresetSketch = Infer<typeof automationPresetSketchSchema>;
