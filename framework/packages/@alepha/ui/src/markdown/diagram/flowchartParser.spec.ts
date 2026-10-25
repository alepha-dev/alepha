import { describe, expect, it } from "vitest";

import { parseFlowchart } from "./flowchartParser.ts";

const parse = (source: string) => {
  const model = parseFlowchart(source);
  if (!model) throw new Error("expected the source to parse");
  return model;
};

const edgeOf = (source: string, index = 0) => parse(source).edges[index];
const nodeById = (source: string, id: string) => {
  const node = parse(source).nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};

describe("parseFlowchart - header", () => {
  it("reads the direction off a flowchart header", () => {
    expect(parse("flowchart LR\n  A --> B").direction).toBe("LR");
  });

  it("maps TD to graphre's TB", () => {
    expect(parse("flowchart TD\n  A --> B").direction).toBe("TB");
  });

  it("accepts the graph alias", () => {
    expect(parse("graph BT\n  A --> B").direction).toBe("BT");
  });

  it("defaults to TB when the header names no direction", () => {
    expect(parse("flowchart\n  A --> B").direction).toBe("TB");
  });

  it("accepts ; as a statement terminator", () => {
    const model = parse("graph TD; A-->B; B-->C;");
    expect(model.edges).toHaveLength(2);
    expect(model.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
  });

  it("skips a YAML frontmatter block", () => {
    expect(parse("---\ntitle: X\n---\nflowchart LR\n  A --> B").direction).toBe(
      "LR",
    );
  });

  it("skips an init directive", () => {
    expect(
      parse('%%{init: {"theme":"dark"}}%%\nflowchart LR\n  A --> B').direction,
    ).toBe("LR");
  });

  it("returns undefined for a diagram type outside the subset", () => {
    expect(parseFlowchart("sequenceDiagram\n  A ->> B: hi")).toBeUndefined();
  });

  it("returns undefined when nothing was declared", () => {
    expect(parseFlowchart("flowchart TD")).toBeUndefined();
  });
});

describe("parseFlowchart - nodes", () => {
  it("declares nodes inline inside an edge statement", () => {
    const model = parse("flowchart TD\n  A[Start] --> B{Ok?}");
    expect(model.nodes).toEqual([
      { id: "A", lines: ["Start"], shape: "rect" },
      { id: "B", lines: ["Ok?"], shape: "diamond" },
    ]);
  });

  it("uses a bare id as its own label", () => {
    expect(nodeById("flowchart TD\n  A --> B", "A").lines).toEqual(["A"]);
  });

  it("keeps the first shape seen when the id is mentioned again bare", () => {
    const node = nodeById("flowchart TD\n  A[Start] --> B\n  B --> A", "A");
    expect(node.lines).toEqual(["Start"]);
    expect(node.shape).toBe("rect");
  });

  it("draws the four native shapes", () => {
    const model = parse("flowchart TD\n  A[r] --> B(ro)\n  C{d} --> D((c))");
    expect(model.nodes.map((n) => n.shape)).toEqual([
      "rect",
      "rounded",
      "diamond",
      "circle",
    ]);
  });

  it.each([
    ["A([stadium])", "rounded", "stadium"],
    ["A[[subroutine]]", "rect", "subroutine"],
    ["A[(cylinder)]", "rect", "cylinder"],
    ["A>flag]", "rect", "flag"],
    ["A[/para/]", "rect", "para"],
    ["A[\\para\\]", "rect", "para"],
    ["A[/trap\\]", "rect", "trap"],
    ["A{{hexagon}}", "diamond", "hexagon"],
    ["A(((double)))", "circle", "double"],
  ])("consumes %s as %s with a clean label", (decl, shape, label) => {
    const node = nodeById(`flowchart TD\n  ${decl} --> B`, "A");
    expect(node.shape).toBe(shape);
    expect(node.lines).toEqual([label]);
  });

  it("turns <br/> and <br> into line breaks", () => {
    expect(
      nodeById("flowchart TD\n  A[one<br/>two<br>three] --> B", "A").lines,
    ).toEqual(["one", "two", "three"]);
  });

  it("strips the quotes off a quoted label", () => {
    expect(
      nodeById('flowchart TD\n  A["text (with) punctuation"] --> B', "A").lines,
    ).toEqual(["text (with) punctuation"]);
  });

  it("renders a markdown string as plain text", () => {
    expect(nodeById('flowchart TD\n  A["`bold`"] --> B', "A").lines).toEqual([
      "bold",
    ]);
  });

  it("accepts a node declared on its own line", () => {
    const model = parse("flowchart TD\n  A[Alone]\n  B --> C");
    expect(model.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(nodeById("flowchart TD\n  A[Alone]\n  B --> C", "A").lines).toEqual([
      "Alone",
    ]);
  });

  it("drops a :::class suffix", () => {
    expect(
      nodeById("flowchart TD\n  A[Start]:::warn --> B", "A").lines,
    ).toEqual(["Start"]);
  });
});

describe("parseFlowchart - edges", () => {
  it.each([
    ["-->", "solid", false, true],
    ["---", "solid", false, false],
    ["-.->", "dashed", false, true],
    ["-.-", "dashed", false, false],
    ["==>", "thick", false, true],
    ["===", "thick", false, false],
    ["<-->", "solid", true, true],
    ["--o", "solid", false, true],
    ["--x", "solid", false, true],
  ])("parses %s", (op, style, arrowStart, arrowEnd) => {
    const edge = edgeOf(`flowchart TD\n  A ${op} B`);
    expect(edge.style).toBe(style);
    expect(edge.arrowStart).toBe(arrowStart);
    expect(edge.arrowEnd).toBe(arrowEnd);
  });

  it("reads a pipe label", () => {
    expect(edgeOf("flowchart TD\n  A -->|yes| B").label).toBe("yes");
  });

  it("reads an inline solid label", () => {
    const edge = edgeOf("flowchart TD\n  A -- yes --> B");
    expect(edge.label).toBe("yes");
    expect(edge.style).toBe("solid");
  });

  it("reads an inline dashed label", () => {
    const edge = edgeOf("flowchart TD\n  A -. maybe .-> B");
    expect(edge.label).toBe("maybe");
    expect(edge.style).toBe("dashed");
  });

  it("reads an inline thick label", () => {
    const edge = edgeOf("flowchart TD\n  A == no ==> B");
    expect(edge.label).toBe("no");
    expect(edge.style).toBe("thick");
  });

  it("keeps a hyphen inside an inline label", () => {
    expect(edgeOf("flowchart TD\n  A -- re-try --> B").label).toBe("re-try");
  });

  it("splits a chain into one edge per hop", () => {
    const model = parse("flowchart TD\n  A --> B --> C");
    expect(model.edges.map((e) => [e.from, e.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  it("does not read a chain as one labelled link", () => {
    expect(parse("flowchart TD\n  A --- B --- C").edges).toHaveLength(2);
  });

  it("expands a fan on the left", () => {
    expect(
      parse("flowchart TD\n  A & B --> C").edges.map((e) => [e.from, e.to]),
    ).toEqual([
      ["A", "C"],
      ["B", "C"],
    ]);
  });

  it("expands a fan on the right", () => {
    expect(
      parse("flowchart TD\n  A --> B & C").edges.map((e) => [e.from, e.to]),
    ).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
  });

  it("turns <br/> in an edge label into a line break", () => {
    expect(edgeOf("flowchart TD\n  A -->|one<br/>two| B").label).toBe(
      "one\ntwo",
    );
  });
});

describe("parseFlowchart - subgraphs", () => {
  it("parses a subgraph with an id and a bracket title", () => {
    const model = parse(
      "flowchart TD\n  subgraph s1 [Backend]\n    A --> B\n  end\n  B --> C",
    );
    expect(model.clusters).toEqual([{ id: "s1", label: "Backend" }]);
    expect(model.nodes.find((n) => n.id === "A")?.parent).toBe("s1");
    expect(model.nodes.find((n) => n.id === "C")?.parent).toBeUndefined();
  });

  it("uses the title as the id when only a title is given", () => {
    const model = parse("flowchart TD\n  subgraph Backend\n    A --> B\n  end");
    expect(model.clusters).toEqual([{ id: "Backend", label: "Backend" }]);
  });

  it("nests subgraphs", () => {
    const model = parse(
      "flowchart TD\n  subgraph outer\n    subgraph inner\n      A --> B\n    end\n  end",
    );
    expect(model.clusters).toEqual([
      { id: "outer", label: "outer" },
      { id: "inner", label: "inner", parent: "outer" },
    ]);
    expect(model.nodes.find((n) => n.id === "A")?.parent).toBe("inner");
  });

  it("ignores a direction line inside a subgraph", () => {
    const model = parse(
      "flowchart TD\n  subgraph s1\n    direction LR\n    A --> B\n  end",
    );
    expect(model.direction).toBe("TB");
    expect(model.nodes.map((n) => n.id)).toEqual(["A", "B"]);
  });

  it("re-targets an edge that points at a cluster to a member node", () => {
    const model = parse(
      "flowchart TD\n  subgraph s1\n    A --> B\n  end\n  s1 --> C",
    );
    const edge = model.edges[model.edges.length - 1];
    expect(edge.from).toBe("A");
    expect(edge.fromCluster).toBe("s1");
    expect(model.nodes.map((n) => n.id)).not.toContain("s1");
  });

  it("drops an edge to a cluster that holds no node", () => {
    const model = parse(
      "flowchart TD\n  subgraph s1\n  end\n  s1 --> C\n  C --> D",
    );
    expect(model.edges.map((e) => [e.from, e.to])).toEqual([["C", "D"]]);
  });
});

describe("parseFlowchart - degrading", () => {
  it("skips styling and interaction statements", () => {
    const model = parse(
      [
        "flowchart TD",
        "  %% a comment",
        "  classDef warn fill:#f00",
        "  class A warn",
        "  style B stroke:#0f0",
        "  linkStyle 0 stroke:#00f",
        "  click A href 'https://x'",
        "  accTitle: A title",
        "  accDescr: A description",
        "  A --> B",
      ].join("\n"),
    );
    expect(model.edges).toHaveLength(1);
    expect(model.nodes.map((n) => n.id)).toEqual(["A", "B"]);
  });

  it("strips a trailing %% comment", () => {
    const model = parse("flowchart TD\n  A --> B %% note\n  B --> C");
    expect(model.edges).toHaveLength(2);
    expect(nodeById("flowchart TD\n  A --> B %% note", "B").lines).toEqual([
      "B",
    ]);
  });

  it("skips a statement it cannot read rather than failing", () => {
    const model = parse("flowchart TD\n  A@{ shape: circle }\n  A --> B");
    expect(model.edges).toHaveLength(1);
  });

  it("never throws on garbage", () => {
    expect(() => parseFlowchart("flowchart TD\n  [[[[ --> ]]]]")).not.toThrow();
  });
});

describe("parseFlowchart - real diagrams", () => {
  it("parses the epic's own starter fence", () => {
    const model = parse(
      [
        "flowchart TD",
        "  A[Start] --> B{Decision}",
        "  B -->|yes| C[Done]",
      ].join("\n"),
    );
    expect(model.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(model.edges).toHaveLength(2);
    expect(model.edges[1].label).toBe("yes");
  });

  it("parses the three-layer architecture diagram from folio #1078", () => {
    const model = parse(
      [
        "flowchart LR",
        '  F["fence text"] --> P["parse<br/>(ours)"]',
        "  P --> G[GraphModel]",
        '  G --> L["layout<br/>(graphre)"]',
        "  L --> PG[PositionedGraph]",
        '  PG --> E["emit<br/>(ours)"] --> S((SVG))',
      ].join("\n"),
    );
    expect(model.direction).toBe("LR");
    expect(model.nodes).toHaveLength(7);
    expect(model.edges).toHaveLength(6);
    expect(model.nodes[1].lines).toEqual(["parse", "(ours)"]);
    expect(model.nodes[6].shape).toBe("circle");
  });

  it("parses a subgraph diagram with mixed edge styles", () => {
    const model = parse(
      [
        "flowchart TD",
        "  subgraph client [Browser]",
        "    MV[MarkdownView] -. lazy .-> D[Diagram]",
        "  end",
        "  subgraph server [Worker]",
        "    API[(D1)]",
        "  end",
        "  D ==> API",
        "  MV <--> API",
      ].join("\n"),
    );
    expect(model.clusters.map((c) => c.id)).toEqual(["client", "server"]);
    expect(model.edges.map((e) => e.style)).toEqual([
      "dashed",
      "thick",
      "solid",
    ]);
    expect(model.edges[2].arrowStart).toBe(true);
  });
});

describe("parseFlowchart - style detection is not fooled by the label", () => {
  it("keeps a solid link solid when its label contains a dot", () => {
    expect(edgeOf("flowchart TD\n  A -- v1.0 --> B").style).toBe("solid");
  });

  it("keeps a thick link thick when its label contains a dot", () => {
    expect(edgeOf("flowchart TD\n  A == 1.5x ==> B").style).toBe("thick");
  });

  it("keeps a pipe-labelled solid link solid when the label has a dot", () => {
    expect(edgeOf("flowchart TD\n  A -->|v1.0| B").style).toBe("solid");
  });
});
