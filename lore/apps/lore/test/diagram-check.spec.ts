import { describe, it } from "vitest";

import { DiagramCheckService } from "../src/mcp/services/DiagramCheckService.ts";

/**
 * The server-side diagram check that reports into the tool result (quest
 * #1301).
 *
 * ⚠️ It exists because the format documentation cannot be relied on to
 * arrive: `DIAGRAM_CAPABILITY` reached an agent through three parameter
 * `.describe()` slots and not through `folio_create`'s tool-level
 * description, in a transport layer Lore cannot observe. A tool RESULT always
 * arrives.
 *
 * These cases are also the executable half of that documentation. Every rule
 * the capability string states is asserted here against the real parser, so
 * the two cannot drift - which is the failure mode the string has already had
 * twice (it claimed a bare `==` cuts a label, and it does not).
 */
describe("the diagram check", () => {
  const service = new DiagramCheckService();
  const fence = (body: string) =>
    `Some prose.\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nMore prose.`;
  const check = (body: string) => service.check(fence(body));

  describe("it stays quiet", () => {
    it("when there is no fence at all", ({ expect }) => {
      expect(service.check("just text, no diagram")).toEqual([]);
      expect(service.check(undefined)).toEqual([]);
    });

    it("for a clean flowchart", ({ expect }) => {
      expect(check("flowchart TD\n  a[Start] --> b[End]")).toEqual([]);
    });

    it("for a clean sequence diagram", ({ expect }) => {
      expect(check("sequenceDiagram\n  participant A\n  A->>B: hi")).toEqual(
        [],
      );
    });

    // A ```ts block is not a diagram, and warning about one would put noise on
    // every folio in the project.
    it("for a code fence that is not mermaid", ({ expect }) => {
      expect(service.check("```ts\nconst a = 1; // classDiagram\n```")).toEqual(
        [],
      );
    });
  });

  /**
   * The rules the capability string documents, each asserted against the
   * parser rather than against mermaid's own documentation - this is a subset
   * parser, and the subset is what decides.
   */
  describe("the documented rules hold", () => {
    it("accepts all three subgraph forms", ({ expect }) => {
      expect(
        check(
          "flowchart TD\n  subgraph d[Device: the binary]\n    a[A]\n  end",
        ),
      ).toEqual([]);
      expect(
        check(
          'flowchart TD\n  subgraph d["Device: the binary"]\n    a[A]\n  end',
        ),
      ).toEqual([]);
      expect(check("flowchart TD\n  subgraph Device\n    a[A]\n  end")).toEqual(
        [],
      );
    });

    // The gap that cost a real guess: brackets are safe inside a label, and
    // silence next to a warning about link operators had read as permission.
    it("accepts brackets inside a label", ({ expect }) => {
      expect(
        check(
          "flowchart TD\n  club[Club worker at {slug}.alepha.club] --> x[X]",
        ),
      ).toEqual([]);
      expect(
        check("flowchart TD\n  a[worker (the binary) runs] --> b[B]"),
      ).toEqual([]);
      expect(check("flowchart TD\n  a[array[0] index] --> b[B]")).toEqual([]);
    });

    it("accepts dots, slashes, at-signs and single hyphens in a node id", ({
      expect,
    }) => {
      expect(
        check("flowchart TD\n  api.v1/users@host[Label] --> my-node[B]"),
      ).toEqual([]);
    });

    // ⚠️ Both of these contradict what the string used to say. A bare `==` is
    // safe; only `===` and `==>` cut. Asserted so the correction cannot be
    // undone by somebody editing from memory of mermaid's own docs.
    it("accepts a bare `==` and a single `-` in a label", ({ expect }) => {
      expect(check("flowchart TD\n  a[x == y] --> b[B]")).toEqual([]);
      expect(check("flowchart TD\n  a[well-formed] --> b[B]")).toEqual([]);
    });
  });

  describe("it reports a label that was cut in half", () => {
    /**
     * ⚠️ The finding the service was built for. `A[x -- y]` is not a syntax
     * error: the `--` reads as an edge, the statement splits, and a diagram
     * still draws - the wrong one. The agent has no way to see that.
     */
    it("catches each link operator that splits a label", ({ expect }) => {
      for (const label of ["x -- y", "x === y", "x ==> y", "x -.- y"]) {
        const warnings = check(`flowchart TD\n  A[${label}] --> B[B]`);
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.join(" ")).toMatch(/label/i);
      }
    });

    it("catches a label consumed entirely, leaving an empty node", ({
      expect,
    }) => {
      expect(check("flowchart TD\n  A[--o] --> B[B]").join(" ")).toMatch(
        /empty label/i,
      );
    });

    // The string says quoting does not protect a link operator. This is that
    // claim, executable.
    it("catches one that was quoted, since quoting does not protect it", ({
      expect,
    }) => {
      expect(check('flowchart TD\n  A["-->"] --> B[B]').length).toBeGreaterThan(
        0,
      );
    });
  });

  describe("it reports a diagram that will not draw", () => {
    it("names an unsupported diagram type", ({ expect }) => {
      const warnings = check("classDiagram\n  class A");
      expect(warnings[0]).toContain("classDiagram");
      expect(warnings[0]).toContain("plain code block");
    });

    /**
     * The sequence parser refuses the whole diagram rather than draw an
     * ordering that is false, and that refusal is silent at render time.
     */
    it("names a refused sequence construct", ({ expect }) => {
      const warnings = check(
        "sequenceDiagram\n  participant A\n  par one\n    A->>B: hi\n  end",
      );
      expect(warnings[0]).toContain("refused");
    });
  });

  describe("across several fences", () => {
    it("names which one is at fault", ({ expect }) => {
      const warnings = service.check(
        `${fence("flowchart TD\n  a --> b")}\n${fence("flowchart TD\n  A[x -- y] --> B[B]")}`,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("fence 2");
    });
  });

  describe("warn()", () => {
    // Absent and empty are the same fact, and absent is cheaper to read: an
    // agent should not have to tell "checked, nothing wrong" from "not
    // checked".
    it("omits the field entirely when there is nothing to say", ({
      expect,
    }) => {
      expect(service.warn(fence("flowchart TD\n  a --> b"))).toEqual({});
      expect(service.warn(undefined)).toEqual({});
    });

    it("carries the warnings when there are any", ({ expect }) => {
      const result = service.warn(fence("flowchart TD\n  A[x -- y] --> B[B]"));
      expect(result.diagramWarnings?.length).toBeGreaterThan(0);
    });
  });
});
