import { diagramKind } from "@alepha/ui/components/markdown-view/diagram/diagramKind.ts";
import { parseFlowchart } from "@alepha/ui/components/markdown-view/diagram/flowchartParser.ts";
import { parseSequence } from "@alepha/ui/components/markdown-view/diagram/sequenceParser.ts";

/**
 * Checks the ` ```mermaid ` fences in markdown an agent just wrote, and says
 * what will not render the way it meant.
 *
 * ## Why this exists at all
 *
 * `DIAGRAM_CAPABILITY` is the only documentation of the diagram format an
 * agent ever sees, and it has two problems it cannot solve from where it
 * sits. It is attached to tool descriptions, which **demonstrably do not
 * always arrive** - the string reached `quest_create`'s parameter and never
 * reached `folio_create`'s tool-level description, in a transport layer Lore
 * neither controls nor can observe. And it can only warn about traps somebody
 * already found the hard way.
 *
 * A tool RESULT always reaches the agent. So the reliable channel is here:
 * parse what was written, in the same turn, before the agent moves on.
 *
 * ⚠️ **Warnings, never rejection.** A half-broken diagram beats a refused
 * write, and this is a rendering concern rather than a correctness one. The
 * content is stored either way.
 *
 * ## Why the findings are read off the parsed model
 *
 * The cheap version of this would be a list of patterns to grep for - and it
 * would only ever catch the traps already in the documentation, which is the
 * limitation being fixed. The parser knows the rest: when a link operator
 * inside a label splits a statement, the wreckage is *visible in the model*
 * as a node whose id carries a bracket or a quote, or a node with an empty
 * label. Those are things no valid diagram produces, and they are found
 * without knowing which operator caused them.
 */
export class DiagramCheckService {
  /**
   * Fences with their 1-based position, so a warning can name which one.
   *
   * ` ```mermaid ` only. An agent that writes ` ```mermaid ` is asking for a
   * diagram; one that writes ` ```text ` is not, and warning about it would
   * be noise on every code block in the project.
   */
  protected fences(markdown: string): Array<{ index: number; source: string }> {
    const found: Array<{ index: number; source: string }> = [];
    const pattern = /^[ \t]*```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)^[ \t]*```/gm;
    let match = pattern.exec(markdown);
    while (match) {
      found.push({ index: found.length + 1, source: match[1] });
      match = pattern.exec(markdown);
    }
    return found;
  }

  /**
   * Everything wrong with the diagrams in this markdown, as sentences meant
   * for an agent to act on. Empty when there is nothing to say, which is the
   * common case and costs one regex.
   */
  public check(markdown: string | undefined): string[] {
    if (!markdown || !markdown.includes("```")) return [];

    const warnings: string[] = [];
    for (const fence of this.fences(markdown)) {
      warnings.push(...this.checkFence(fence.index, fence.source));
    }
    return warnings;
  }

  /**
   * `check`, shaped to spread into a tool result: `{}` when there is nothing
   * to say, so the field is absent rather than an empty array.
   *
   * Absent and empty are the same fact here, and absent is the cheaper one to
   * read - an agent scanning a result should not have to distinguish "checked,
   * nothing wrong" from "not checked". Every call site spreads this.
   *
   * ⚠️ Pass the content that was WRITTEN, and nothing else. A tool that only
   * renamed a folio must not be handed the body it did not touch: warning
   * about a diagram the agent did not write in this call is noise it cannot
   * act on and did not cause.
   */
  public warn(markdown: string | undefined): { diagramWarnings?: string[] } {
    const warnings = this.check(markdown);
    return warnings.length > 0 ? { diagramWarnings: warnings } : {};
  }

  protected checkFence(index: number, source: string): string[] {
    const at = `fence ${index}`;
    const kind = diagramKind(source);

    if (!kind) {
      const header = source.trim().split(/\r?\n/)[0]?.trim() ?? "";
      return [
        `${at}: \`${header}\` is not a diagram type Lore draws, so it will render as a plain code block. Only \`flowchart\` and \`sequenceDiagram\` are drawn.`,
      ];
    }

    if (kind === "sequence") {
      // The sequence parser refuses the WHOLE diagram rather than draw an
      // ordering that is false - `par`, `critical`, `break`, `create`,
      // `destroy`. That refusal is silent at render time, which is exactly
      // the class of failure this service exists to make loud.
      return parseSequence(source)
        ? []
        : [
            `${at}: this \`sequenceDiagram\` was refused and will render as a plain code block. \`par\`, \`critical\`, \`break\`, \`create\` and \`destroy\` are refused outright rather than drawn wrongly.`,
          ];
    }

    const model = parseFlowchart(source);
    if (!model) {
      return [
        `${at}: this flowchart could not be parsed and will render as a plain code block.`,
      ];
    }

    return this.checkFlowchartLabels(at, model);
  }

  /**
   * ⚠️ The finding the whole service was built for: a label cut in half.
   *
   * `A[x -- y]` is not a syntax error. The `--` reads as an edge, the
   * statement splits around it, and a diagram still draws - with a node
   * labelled `x`, an edge, and a node whose id is the literal `y]`. The agent
   * sees a diagram and has no way to know it is the wrong one.
   *
   * Three signatures, none of which a valid diagram produces:
   *
   * - an id carrying `]`, `)`, `}` or `"` - the tail of a label that was left
   *   behind when the statement split;
   * - a node with an empty label, which is the head of that same split
   *   (`A[--o]` leaves `A` labelled with nothing at all);
   * - an edge label ending in a closing bracket, the same tail arriving on
   *   the other side of the split.
   */
  protected checkFlowchartLabels(
    at: string,
    model: {
      nodes: Array<{ id: string; lines: string[] }>;
      edges: Array<{ label?: string }>;
    },
  ): string[] {
    const warnings: string[] = [];

    for (const node of model.nodes) {
      if (/[\]})"]/.test(node.id)) {
        warnings.push(
          `${at}: a node label was cut in half - the fragment \`${node.id}\` became a node of its own. A link operator (\`--\`, \`===\`, \`==>\`, \`-.-\`) inside a \`[...]\` label reads as an edge, and quoting does not protect it. Reword the label.`,
        );
      } else if (node.lines.every((line) => line === "")) {
        warnings.push(
          `${at}: node \`${node.id}\` ended up with an empty label. A link operator (\`--\`, \`===\`, \`==>\`, \`-.-\`) inside its \`[...]\` label was read as an edge and consumed the text. Reword the label.`,
        );
      }
    }

    for (const edge of model.edges) {
      if (edge.label && /[\]})]$/.test(edge.label)) {
        warnings.push(
          `${at}: \`${edge.label}\` became an EDGE label rather than part of a node label - a \`--\` inside a \`[...]\` label reads as a labelled edge. Reword the label.`,
        );
      }
    }

    return warnings;
  }
}
