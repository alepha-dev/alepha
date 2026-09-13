import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { layoutSequence } from "../layoutSequence.ts";
import { SequenceDiagram } from "../SequenceDiagram.tsx";
import { parseSequence } from "../sequenceParser.ts";

const diagramOf = (source: string) => {
  const model = parseSequence(source);
  if (!model) throw new Error("source did not parse");
  const diagram = layoutSequence(model);
  if (!diagram) throw new Error("source did not lay out");
  return diagram;
};

const draw = (source: string) =>
  render(<SequenceDiagram diagram={diagramOf(source)} />).container;

describe("SequenceDiagram - the SVG root", () => {
  it("renders one svg sized by the layout's viewBox", () => {
    const svg = draw("sequenceDiagram\n  A ->> B: hi").querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toMatch(/^0 0 [\d.]+ [\d.]+$/);
  });

  it("takes its natural width rather than scaling to the column", () => {
    // The opposite of the flowchart emitter, and deliberately so: a
    // sequence diagram's width comes from participant count with nothing to
    // wrap, so scaling it into a phone column puts labels at ~5px.
    const svg = draw("sequenceDiagram\n  A ->> B: hi").querySelector("svg");
    expect(Number(svg?.getAttribute("width"))).toBeGreaterThan(0);
  });

  it("pins its own font instead of inheriting the surrounding prose", () => {
    const svg = draw("sequenceDiagram\n  A ->> B: hi").querySelector("svg");
    expect(svg?.getAttribute("font-family")).toContain("Inter");
    expect(svg?.getAttribute("font-size")).toBe("13");
  });

  it("logs no invalid DOM property for the font attributes", () => {
    // camelCase `fontFamily` / `fontSize` render the same SVG presentation
    // attributes; the hyphenated spelling renders them AND warns, on every
    // render, from a component mounted on every markdown surface.
    const warnings: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => warnings.push(args);
    try {
      draw("sequenceDiagram\n  A ->> B: hi");
    } finally {
      console.error = original;
    }
    expect(warnings).toEqual([]);
  });

  it("carries an accessible name", () => {
    const svg = draw("sequenceDiagram\n  A ->> B: hi").querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.querySelector("title")?.textContent).toBeTruthy();
  });

  it("namespaces its marker ids so two diagrams on a page do not fight", () => {
    const first = draw("sequenceDiagram\n  A ->> B: hi");
    const second = draw("sequenceDiagram\n  A ->> B: hi");
    const idOf = (container: Element) =>
      container.querySelector("marker")?.getAttribute("id");
    expect(idOf(first)).toBeTruthy();
    expect(idOf(first)).not.toBe(idOf(second));
  });
});

describe("SequenceDiagram - participants", () => {
  it("draws a lifeline per participant", () => {
    const container = draw("sequenceDiagram\n  A ->> B: hi\n  B ->> C: bye");
    expect(container.querySelectorAll("[data-participant]")).toHaveLength(3);
  });

  it("repeats each header box at the bottom", () => {
    const boxes = draw("sequenceDiagram\n  A ->> B: hi").querySelectorAll(
      "[data-participant] rect",
    );
    expect(boxes).toHaveLength(4);
  });

  it("draws an actor as a stick figure rather than a box", () => {
    const container = draw("sequenceDiagram\n  actor U\n  U ->> S: hi");
    const actor = container.querySelector('[data-participant="U"]');
    const service = container.querySelector('[data-participant="S"]');
    expect(actor?.querySelectorAll("circle").length).toBe(2);
    expect(actor?.querySelector("rect")).toBeNull();
    expect(service?.querySelector("rect")).not.toBeNull();
  });

  it("names the lifeline with the alias, not the id", () => {
    const container = draw(
      "sequenceDiagram\n  participant A as Alice\n  A ->> B: hi",
    );
    expect(
      container.querySelector('[data-participant="A"]')?.textContent,
    ).toContain("Alice");
  });
});

describe("SequenceDiagram - messages", () => {
  it("draws a message as a path between two lifelines", () => {
    const path = draw("sequenceDiagram\n  A ->> B: hi").querySelector(
      '[data-message="A->B"]',
    );
    expect(path?.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
  });

  it("dashes the -->> form and not the ->> one", () => {
    const container = draw(
      "sequenceDiagram\n  A ->> B: solid\n  B -->> A: dashed",
    );
    const [solid, dashed] = container.querySelectorAll("[data-message]");
    expect(solid.getAttribute("stroke-dasharray")).toBeNull();
    expect(dashed.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("gives the three head kinds three different markers", () => {
    const container = draw(
      [
        "sequenceDiagram",
        "  A ->> B: filled",
        "  A -x B: cross",
        "  A -) B: open",
      ].join("\n"),
    );
    const markers = [...container.querySelectorAll("[data-message]")].map((m) =>
      m.getAttribute("marker-end"),
    );
    expect(new Set(markers).size).toBe(3);
  });

  it("draws no head at all for the plain -> form", () => {
    const path = draw("sequenceDiagram\n  A -> B: plain").querySelector(
      "[data-message]",
    );
    expect(path?.getAttribute("marker-end")).toBeNull();
  });

  it("paints every arrowhead with context-stroke, never currentColor", () => {
    // A marker lives in `<defs>`, so `currentColor` resolves against the
    // MARKER's inherited colour rather than the referencing line's: the
    // head came out `--foreground` while its line was `--muted-foreground`.
    const container = draw(
      "sequenceDiagram\n  A ->> B: a\n  A -x B: b\n  A -) B: c",
    );
    const painted = [...container.querySelectorAll("marker path")].flatMap(
      (path) => [path.getAttribute("fill"), path.getAttribute("stroke")],
    );
    expect(painted.filter(Boolean)).not.toContain("currentColor");
    expect(painted).toContain("context-stroke");
  });

  it("draws a self-message as a loop with four corners", () => {
    const path = draw("sequenceDiagram\n  A ->> A: retry").querySelector(
      "[data-message]",
    );
    expect(path?.getAttribute("d")).toContain("Q");
  });

  it("writes the label, and the autonumber counter with it", () => {
    const container = draw(
      "sequenceDiagram\n  autonumber\n  A ->> B: signs the token",
    );
    expect(container.textContent).toContain("1. signs the token");
  });

  it("draws no label chip for an empty label", () => {
    // Four `text` nodes either way: two participants, each named twice
    // (header and repeated footer). The fifth is the message's own label.
    const empty = draw("sequenceDiagram\n  A ->> B:");
    const labelled = draw("sequenceDiagram\n  A ->> B: hi");
    expect(empty.querySelectorAll("text")).toHaveLength(4);
    expect(labelled.querySelectorAll("text")).toHaveLength(5);
    expect(empty.querySelectorAll("rect")).toHaveLength(4);
    expect(labelled.querySelectorAll("rect")).toHaveLength(5);
  });
});

describe("SequenceDiagram - notes and fragments", () => {
  it("draws a note as a filled box with its text", () => {
    const container = draw(
      "sequenceDiagram\n  A ->> B: hi\n  Note over A,B: shared state",
    );
    const note = container.querySelector("[data-note]");
    expect(note?.getAttribute("data-note")).toBe("over");
    expect(note?.querySelector("rect")?.getAttribute("fill")).toBe(
      "var(--muted)",
    );
    expect(note?.textContent).toContain("shared state");
  });

  it("draws a fragment as an unfilled box with a tab", () => {
    const container = draw(
      "sequenceDiagram\n  alt known\n    A ->> B: yes\n  end",
    );
    const fragment = container.querySelector("[data-fragment]");
    expect(fragment?.getAttribute("data-fragment")).toBe("alt");
    // An outline, so it never hides a lifeline it spans.
    expect(fragment?.querySelector("rect")?.getAttribute("fill")).toBe("none");
    expect(fragment?.textContent).toContain("alt");
    expect(fragment?.textContent).toContain("[known]");
  });

  it("draws a dashed divider per else, with its condition", () => {
    const fragment = draw(
      [
        "sequenceDiagram",
        "  alt known",
        "    A ->> B: yes",
        "  else unknown",
        "    A ->> B: no",
        "  end",
      ].join("\n"),
    ).querySelector("[data-fragment]");
    const dashed = [...(fragment?.querySelectorAll("line") ?? [])].filter(
      (line) => line.getAttribute("stroke-dasharray"),
    );
    expect(dashed).toHaveLength(1);
    expect(fragment?.textContent).toContain("[unknown]");
  });

  it("draws nested fragments outermost first, so order is z-order", () => {
    const fragments = draw(
      [
        "sequenceDiagram",
        "  loop retry",
        "    alt ok",
        "      A ->> B: one",
        "    end",
        "  end",
      ].join("\n"),
    ).querySelectorAll("[data-fragment]");
    expect([...fragments].map((f) => f.getAttribute("data-fragment"))).toEqual([
      "loop",
      "alt",
    ]);
  });
});

describe("SequenceDiagram - theming", () => {
  it("takes every colour from a CSS variable", () => {
    const container = draw(
      [
        "sequenceDiagram",
        "  actor U",
        "  U ->> S: hi",
        "  Note over S: think",
        "  alt yes",
        "    S -->> U: ok",
        "  end",
      ].join("\n"),
    );
    const colours = [...container.querySelectorAll("*")].flatMap((node) =>
      ["fill", "stroke"]
        .map((attribute) => node.getAttribute(attribute))
        .filter((value): value is string => Boolean(value)),
    );
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours)
      expect(colour).toMatch(
        /^(var\(--[\w-]+\)|none|currentColor|context-stroke)$/,
      );
  });
});
