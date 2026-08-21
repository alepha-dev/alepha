import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowchartDiagram } from "../FlowchartDiagram.tsx";
import { parseFlowchart } from "../flowchartParser.ts";
import { layoutFlowchart } from "../layoutFlowchart.ts";

const graphOf = (source: string) => {
  const model = parseFlowchart(source);
  if (!model) throw new Error("source did not parse");
  const graph = layoutFlowchart(model);
  if (!graph) throw new Error("source did not lay out");
  return graph;
};

const draw = (source: string) =>
  render(<FlowchartDiagram graph={graphOf(source)} />).container;

describe("FlowchartDiagram - the SVG root", () => {
  it("renders one svg sized by the layout's viewBox", () => {
    const svg = draw("flowchart TD\n  A[Start] --> B[Done]").querySelector(
      "svg",
    );
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toMatch(/^0 0 [\d.]+ [\d.]+$/);
  });

  it("scales to its container rather than to a pixel size", () => {
    const svg = draw("flowchart TD\n  A --> B").querySelector("svg");
    expect(svg?.getAttribute("width")).toBeNull();
    expect(svg?.style.maxWidth).not.toBe("");
  });

  it("pins its own font instead of inheriting the surrounding prose", () => {
    const svg = draw("flowchart TD\n  A --> B").querySelector("svg");
    expect(svg?.getAttribute("font-family")).toContain("Inter");
    expect(svg?.getAttribute("font-size")).toBe("13");
  });

  it("carries an accessible name", () => {
    const svg = draw("flowchart TD\n  A --> B").querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.querySelector("title")?.textContent).toBeTruthy();
  });
});

describe("FlowchartDiagram - shapes", () => {
  it("draws a rect node as a rect", () => {
    expect(
      draw("flowchart TD\n  A[Box] --> B").querySelectorAll("rect").length,
    ).toBeGreaterThan(0);
  });

  it("draws a rounded node with a corner radius", () => {
    const rounded = [
      ...draw("flowchart TD\n  A(Round) --> B").querySelectorAll("rect"),
    ].find((r) => Number(r.getAttribute("rx")) > 4);
    expect(rounded).toBeDefined();
  });

  it("draws a diamond as a polygon", () => {
    expect(
      draw("flowchart TD\n  A{Ok?} --> B").querySelector("polygon"),
    ).not.toBeNull();
  });

  it("draws a circle as an ellipse", () => {
    expect(
      draw("flowchart TD\n  A((Round)) --> B").querySelector("ellipse"),
    ).not.toBeNull();
  });

  it("renders every node label", () => {
    const container = draw("flowchart TD\n  A[Start] --> B{Decision}");
    expect(container.textContent).toContain("Start");
    expect(container.textContent).toContain("Decision");
  });

  it("draws one tspan per label line", () => {
    const stacked = [
      ...draw("flowchart TD\n  A[one<br/>two] --> B").querySelectorAll("text"),
    ].find((t) => t.querySelectorAll("tspan").length === 2);
    expect(stacked).toBeDefined();
  });
});

describe("FlowchartDiagram - edges", () => {
  it("draws one path per edge", () => {
    expect(
      draw("flowchart TD\n  A --> B --> C").querySelectorAll("path[data-edge]"),
    ).toHaveLength(2);
  });

  it("dashes a dotted edge", () => {
    const path = draw("flowchart TD\n  A -.-> B").querySelector(
      "path[data-edge]",
    );
    expect(path?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("thickens a thick edge", () => {
    const thin = draw("flowchart TD\n  A --> B").querySelector(
      "path[data-edge]",
    );
    const thick = draw("flowchart TD\n  A ==> B").querySelector(
      "path[data-edge]",
    );
    expect(Number(thick?.getAttribute("stroke-width"))).toBeGreaterThan(
      Number(thin?.getAttribute("stroke-width")),
    );
  });

  it("puts an arrowhead only on the end of a one-way edge", () => {
    const path = draw("flowchart TD\n  A --> B").querySelector(
      "path[data-edge]",
    );
    expect(path?.getAttribute("marker-end")).toBeTruthy();
    expect(path?.getAttribute("marker-start")).toBeNull();
  });

  it("puts an arrowhead on both ends of a two-way edge", () => {
    const path = draw("flowchart TD\n  A <--> B").querySelector(
      "path[data-edge]",
    );
    expect(path?.getAttribute("marker-start")).toBeTruthy();
    expect(path?.getAttribute("marker-end")).toBeTruthy();
  });

  it("draws no arrowhead on a plain link", () => {
    const path = draw("flowchart TD\n  A --- B").querySelector(
      "path[data-edge]",
    );
    expect(path?.getAttribute("marker-end")).toBeNull();
  });

  it("renders an edge label on a backing chip", () => {
    const container = draw("flowchart TD\n  A -->|yes| B");
    expect(container.textContent).toContain("yes");
    expect(container.querySelector("rect[data-edge-label]")).not.toBeNull();
  });

  it("namespaces its marker ids so two diagrams on a page do not fight", () => {
    const { container } = render(
      <>
        <FlowchartDiagram graph={graphOf("flowchart TD\n  A --> B")} />
        <FlowchartDiagram graph={graphOf("flowchart TD\n  C --> D")} />
      </>,
    );
    const ids = [...container.querySelectorAll("marker")].map((m) => m.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("FlowchartDiagram - clusters", () => {
  it("draws a box and a label per subgraph", () => {
    const container = draw(
      "flowchart TD\n  subgraph s1 [Backend]\n    A --> B\n  end\n  B --> C",
    );
    expect(container.querySelector("rect[data-cluster]")).not.toBeNull();
    expect(container.textContent).toContain("Backend");
  });

  it("draws clusters before their members so members stay on top", () => {
    const container = draw(
      "flowchart TD\n  subgraph s1 [Backend]\n    A --> B\n  end",
    );
    const all = [...container.querySelectorAll("[data-cluster], [data-node]")];
    expect(all[0].getAttribute("data-cluster")).toBe("s1");
  });
});

describe("FlowchartDiagram - escaping", () => {
  it("renders a label that looks like markup as text, never as elements", () => {
    const container = draw(
      'flowchart TD\n  A["<script>alert(1)</script>"] --> B',
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("alert(1)");
  });
});

describe("FlowchartDiagram - arrowheads follow their edge", () => {
  /**
   * `currentColor` inside a `<marker>` resolves against the MARKER's own
   * inherited colour (it lives in `<defs>`, not inside the edge group), so
   * an arrowhead painted that way is `--foreground` while its line is
   * `--muted-foreground`, and in a differently-themed container it is the
   * wrong colour outright. `context-stroke` is the SVG2 keyword that takes
   * the colour from the element referencing the marker.
   */
  it("paints the arrowhead from the referencing edge's stroke", () => {
    const container = draw("flowchart TD\n  A --> B");
    for (const path of container.querySelectorAll("marker path")) {
      expect(path.getAttribute("fill")).toBe("context-stroke");
    }
  });
});

describe("FlowchartDiagram - circle nodes", () => {
  it("draws a wide label as an oval, not as a giant square circle", () => {
    const ellipse = draw(
      "flowchart TD\n  A((a fairly wide label)) --> B",
    ).querySelector("ellipse");
    const rx = Number(ellipse?.getAttribute("rx"));
    const ry = Number(ellipse?.getAttribute("ry"));
    expect(rx).toBeGreaterThan(ry);
    expect(rx / ry).toBeLessThan(4);
  });
});
