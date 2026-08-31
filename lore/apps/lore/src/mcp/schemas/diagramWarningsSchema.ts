import { z } from "alepha";

/**
 * What will not render the way the writer meant, in the ` ```mermaid ` fences
 * of the content just written. Absent when there is nothing to say, which is
 * the common case.
 *
 * ⚠️ **Warnings, never rejection.** The write landed; these describe how it
 * will DRAW. A half-broken diagram beats a refused write.
 *
 * This field exists because the format documentation cannot be relied on to
 * arrive. `DIAGRAM_CAPABILITY` rides on tool descriptions, and one of those
 * was observed reaching an agent on three tools and not on a fourth, in a
 * transport layer Lore neither controls nor can observe. A tool RESULT always
 * arrives - so the reliable channel is here, in the same turn, before the
 * agent moves on. It also catches what the documentation never anticipated:
 * the findings are read off the parsed model rather than from a list of known
 * traps.
 */
export const diagramWarningsSchema = z
  .array(z.string())
  .describe(
    "Problems found in the ```mermaid fences of the content just written. The write SUCCEEDED - these say how the diagram will draw, not that anything was rejected. A cut label or a refused diagram type still renders, just not as intended: fix the source and call the update tool again. Absent when there is nothing wrong.",
  )
  .optional();

/**
 * The shape to spread into a result schema's `.extend()`, so every write
 * surface names the field identically.
 */
export const diagramWarningsShape = { diagramWarnings: diagramWarningsSchema };
