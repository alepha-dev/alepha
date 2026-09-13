import { describe, expect, it } from "vitest";

import {
  GAP_LABEL_MARGIN,
  layoutSequence,
  MAX_SEQUENCE_MESSAGES,
  MAX_SEQUENCE_PARTICIPANTS,
} from "./layoutSequence.ts";
import { parseSequence } from "./sequenceParser.ts";
import { DIAGRAM_FONT_SIZE, measureLabel } from "./textMetrics.ts";

const lay = (source: string) => {
  const model = parseSequence(source);
  if (!model) throw new Error("source did not parse");
  const diagram = layoutSequence(model);
  if (!diagram) throw new Error("source did not lay out");
  return diagram;
};

const centerOf = (source: string, id: string) => {
  const participant = lay(source).participants.find((p) => p.id === id);
  if (!participant) throw new Error(`no participant ${id}`);
  return participant.centerX;
};

/**
 * `toBeCloseTo` takes DIGITS, not a tolerance - `toBeCloseTo(x, 0.05 * x)`
 * demands five decimal places, which is the opposite of a 5% band. Relative
 * error is asserted directly instead.
 */
const relativeError = (actual: number, expected: number) =>
  Math.abs(actual - expected) / expected;

describe("layoutSequence - the plane", () => {
  it("places lifelines left to right in declaration order", () => {
    const source =
      "sequenceDiagram\n  participant C\n  participant A\n  C ->> A: hi";
    expect(centerOf(source, "C")).toBeLessThan(centerOf(source, "A"));
  });

  it("keeps every drawn element inside the viewBox", () => {
    const diagram = lay(
      [
        "sequenceDiagram",
        "  Note left of A: hangs off the left",
        "  A ->> B: one",
        "  B ->> B: loops",
        "  Note right of B: hangs off the right",
      ].join("\n"),
    );
    const xs = [
      ...diagram.participants.flatMap((p) => [p.x, p.x + p.width]),
      ...diagram.notes.flatMap((n) => [n.x, n.x + n.width]),
      ...diagram.messages.flatMap((m) => [
        ...m.points.map((point) => point.x),
        m.label.x,
        m.label.x + m.label.width,
      ]),
    ];
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(diagram.width);
  });

  it("starts every lifeline at the same y whatever the header heights", () => {
    const diagram = lay(
      "sequenceDiagram\n  actor U\n  participant S as A<br/>two-line<br/>name\n  U ->> S: hi",
    );
    const tops = new Set(diagram.participants.map((p) => p.lifelineTop));
    expect(tops.size).toBe(1);
  });

  it("repeats the participant boxes at the bottom, below every row", () => {
    const diagram = lay("sequenceDiagram\n  A ->> B: one\n  B ->> A: two");
    for (const participant of diagram.participants) {
      expect(participant.bottomY).toBe(participant.lifelineBottom);
      expect(participant.bottomY).toBeGreaterThan(
        Math.max(...diagram.messages.map((m) => m.points[0].y)),
      );
      expect(participant.bottomY + participant.height).toBeLessThanOrEqual(
        diagram.height,
      );
    }
  });

  it("emits top-left corners, not centres", () => {
    const [first] = lay("sequenceDiagram\n  A ->> B: hi").participants;
    expect(first.x).toBeCloseTo(first.centerX - first.width / 2, 6);
  });
});

describe("layoutSequence - collisions", () => {
  /**
   * A realistic protocol, of the shape this whole feature exists for: long
   * labels, a long-range hop, a note, a self-message and a fragment. The
   * invariants below are what "the diagram is readable" actually means, and
   * they are the ones a green suite of narrower tests can still miss.
   */
  const source = [
    "sequenceDiagram",
    "  autonumber",
    "  participant W as WebView",
    "  participant S as Shell worker",
    "  participant T as Tenant worker",
    "  participant D as Database",
    "  W ->> S: GET /api/me with a Bearer token",
    "  S ->> S: rewrite the cookie",
    "  alt token is valid",
    "    S ->> T: forward, resolving the tenant by Host",
    "    T ->> D: select the member row",
    "    D -->> T: one row",
    "    T -->> W: 200 with the profile",
    "  else token is expired",
    "    S --x W: 401",
    "  end",
    "  Note over S,T: both run on the same isolate",
  ].join("\n");

  it("never draws a message label across a lifeline", () => {
    const diagram = lay(source);
    for (const message of diagram.messages) {
      if (message.self) continue;
      const left = Math.min(message.points[0].x, message.points[1].x);
      const right = Math.max(message.points[0].x, message.points[1].x);
      expect(message.label.x).toBeGreaterThanOrEqual(left);
      expect(message.label.x + message.label.width).toBeLessThanOrEqual(right);
    }
  });

  it("never draws a self-loop or its label onto the next lifeline", () => {
    const diagram = lay(source);
    for (const message of diagram.messages) {
      if (!message.self) continue;
      const own = diagram.participants.findIndex((p) => p.id === message.from);
      const next = diagram.participants[own + 1];
      if (!next) continue;
      expect(message.label.x + message.label.width).toBeLessThan(next.centerX);
    }
  });

  it("never draws a spanning note onto a lifeline outside its span", () => {
    const diagram = lay(source);
    for (const note of diagram.notes) {
      for (const participant of diagram.participants) {
        const inside =
          note.x <= participant.centerX &&
          participant.centerX <= note.x + note.width;
        if (!inside) continue;
        // Only the lifelines the note is anchored over may be under it, and
        // `Note over S,T` covers exactly the two it names.
        expect(["S", "T"]).toContain(participant.id);
      }
    }
  });

  it("never overlaps two rows", () => {
    const diagram = lay(source);
    const rows = [
      ...diagram.messages.map((m) => ({
        top: Math.min(m.label.y, m.points[0].y),
        bottom: Math.max(
          m.label.y + m.label.height,
          ...m.points.map((p) => p.y),
        ),
      })),
      ...diagram.notes.map((n) => ({ top: n.y, bottom: n.y + n.height })),
    ].sort((a, b) => a.top - b.top);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom);
  });

  it("keeps every row inside the lifelines", () => {
    const diagram = lay(source);
    const [first] = diagram.participants;
    for (const message of diagram.messages) {
      expect(message.label.y).toBeGreaterThanOrEqual(first.lifelineTop);
      for (const point of message.points)
        expect(point.y).toBeLessThanOrEqual(first.lifelineBottom);
    }
  });
});

describe("layoutSequence - column pass one", () => {
  it("gives two adjacent boxes room to sit side by side", () => {
    const diagram = lay(
      "sequenceDiagram\n  participant A as A very long participant name\n  participant B\n  A ->> B: x",
    );
    const [a, b] = diagram.participants;
    expect(a.x + a.width).toBeLessThan(b.x);
  });

  it("widens the gap for a long label between two neighbours", () => {
    const narrow = centerOf("sequenceDiagram\n  A ->> B: hi", "B");
    const wide = centerOf(
      "sequenceDiagram\n  A ->> B: a considerably longer message label",
      "B",
    );
    expect(wide).toBeGreaterThan(narrow);
  });

  it("fits the label inside the gap it widened, with the margin applied", () => {
    const source = "sequenceDiagram\n  A ->> B: a considerably longer label";
    const diagram = lay(source);
    const span =
      diagram.participants[1].centerX - diagram.participants[0].centerX;
    const label = measureLabel(
      ["a considerably longer label"],
      DIAGRAM_FONT_SIZE,
    );
    expect(span).toBeGreaterThanOrEqual(label.width * GAP_LABEL_MARGIN);
  });
});

describe("layoutSequence - column pass two", () => {
  it("widens a long-range span rather than one gap of it", () => {
    const short = lay(
      "sequenceDiagram\n  A ->> B: x\n  B ->> C: y\n  A ->> C: z",
    );
    const long = lay(
      [
        "sequenceDiagram",
        "  A ->> B: x",
        "  B ->> C: y",
        "  A ->> C: a label far wider than any single gap needs to be",
      ].join("\n"),
    );
    const spanOf = (diagram: ReturnType<typeof lay>) =>
      diagram.participants[2].centerX - diagram.participants[0].centerX;
    expect(spanOf(long)).toBeGreaterThan(spanOf(short));
  });

  it("distributes the extra evenly across the gaps it crosses", () => {
    const diagram = lay(
      [
        "sequenceDiagram",
        "  participant A",
        "  participant B",
        "  participant C",
        "  A ->> C: a label far wider than any single gap needs to be",
      ].join("\n"),
    );
    const [a, b, c] = diagram.participants;
    // The two gaps start equal (identical one-letter boxes), so an even
    // distribution leaves them equal. A pass that dumped the shortfall on
    // one gap would put the label off-centre over its own span.
    expect(
      relativeError(b.centerX - a.centerX, c.centerX - b.centerX),
    ).toBeLessThan(0.001);
  });

  it("centres a long-range label over its whole span", () => {
    const diagram = lay(
      "sequenceDiagram\n  A ->> B: x\n  B ->> C: y\n  A ->> C: spanning label",
    );
    const spanning = diagram.messages[2];
    const middle = (spanning.points[0].x + spanning.points[1].x) / 2;
    expect(spanning.label.x + spanning.label.width / 2).toBeCloseTo(middle, 6);
  });

  it("widens the span a two-participant note covers", () => {
    const narrow = lay("sequenceDiagram\n  A ->> B: x\n  Note over A,B: n");
    const wide = lay(
      "sequenceDiagram\n  A ->> B: x\n  Note over A,B: a much longer note that needs the room",
    );
    const spanOf = (diagram: ReturnType<typeof lay>) =>
      diagram.participants[1].centerX - diagram.participants[0].centerX;
    expect(spanOf(wide)).toBeGreaterThan(spanOf(narrow));
  });

  it("widens the gap beside a one-participant note", () => {
    const narrow = lay("sequenceDiagram\n  A ->> B: x\n  Note right of A: n");
    const wide = lay(
      "sequenceDiagram\n  A ->> B: x\n  Note right of A: a much longer note here",
    );
    const spanOf = (diagram: ReturnType<typeof lay>) =>
      diagram.participants[1].centerX - diagram.participants[0].centerX;
    expect(spanOf(wide)).toBeGreaterThan(spanOf(narrow));
  });

  it("leaves a note that hangs off the left edge inside the diagram", () => {
    const diagram = lay(
      "sequenceDiagram\n  A ->> B: x\n  Note left of A: a note hanging off the left edge",
    );
    expect(diagram.notes[0].x).toBeGreaterThanOrEqual(0);
  });
});

describe("layoutSequence - self-messages", () => {
  it("loops out to the right of its own lifeline", () => {
    const [message] = lay("sequenceDiagram\n  A ->> A: retry").messages;
    expect(message.self).toBe(true);
    expect(message.points).toHaveLength(4);
    expect(message.points[1].x).toBeGreaterThan(message.points[0].x);
    expect(message.points[3].x).toBe(message.points[0].x);
    expect(message.points[3].y).toBeGreaterThan(message.points[0].y);
  });

  it("puts the label beyond the loop rather than over it", () => {
    const [message] = lay("sequenceDiagram\n  A ->> A: retry").messages;
    expect(message.label.x).toBeGreaterThan(message.points[1].x);
  });

  it("takes a taller row than a normal message", () => {
    const self = lay("sequenceDiagram\n  A ->> A: x\n  A ->> B: y");
    const [loop, plain] = self.messages;
    expect(loop.points[3].y - loop.points[0].y).toBeGreaterThan(0);
    expect(plain.points[0].y).toBeGreaterThan(loop.points[3].y);
  });

  it("keeps a loop on the LAST participant inside the diagram", () => {
    const diagram = lay(
      "sequenceDiagram\n  A ->> B: x\n  B ->> B: a self message with a long label",
    );
    const loop = diagram.messages[1];
    expect(loop.label.x + loop.label.width).toBeLessThanOrEqual(diagram.width);
  });

  it("keeps the gap clear when the loop is not on the last participant", () => {
    const diagram = lay(
      "sequenceDiagram\n  A ->> A: a self message with a long label\n  A ->> B: x",
    );
    const loop = diagram.messages[0];
    expect(loop.label.x + loop.label.width).toBeLessThan(
      diagram.participants[1].centerX,
    );
  });
});

describe("layoutSequence - autonumber", () => {
  it("numbers the messages into the labels", () => {
    const diagram = lay(
      "sequenceDiagram\n  autonumber\n  A ->> B: one\n  B ->> A: two",
    );
    expect(diagram.messages.map((m) => m.label.lines[0])).toEqual([
      "1. one",
      "2. two",
    ]);
  });

  it("honours a start and a step", () => {
    const diagram = lay(
      "sequenceDiagram\n  autonumber 10 5\n  A ->> B: one\n  B ->> A: two",
    );
    expect(diagram.messages.map((m) => m.label.lines[0])).toEqual([
      "10. one",
      "15. two",
    ]);
  });

  it("does not number notes", () => {
    const diagram = lay(
      "sequenceDiagram\n  autonumber\n  A ->> B: one\n  Note over B: think\n  B ->> A: two",
    );
    expect(diagram.notes[0].lines[0]).toBe("think");
    expect(diagram.messages[1].label.lines[0]).toBe("2. two");
  });

  it("measures the counter, not just the label", () => {
    // The trap this pins: numbering AFTER measuring makes every column too
    // narrow, and it stays invisible until the numbers go double-digit. The
    // label has to be long enough that it is what sets the gap - a short
    // one leaves the two boxes' own clearance in charge and the two spans
    // come out identical whether or not the counter was measured - and
    // short enough that adding the counter does not push it past
    // `MAX_LABEL_WIDTH` and wrap it, which would make the widest line
    // NARROWER and invert the comparison.
    const label = "signs the token";
    const plain = lay(`sequenceDiagram\n  A ->> B: ${label}`);
    const numbered = lay(
      `sequenceDiagram\n  autonumber 100\n  A ->> B: ${label}`,
    );
    const spanOf = (diagram: ReturnType<typeof lay>) =>
      diagram.participants[1].centerX - diagram.participants[0].centerX;
    expect(spanOf(numbered)).toBeGreaterThan(spanOf(plain));
  });

  it("fits the numbered label in the gap it widened", () => {
    const diagram = lay(
      "sequenceDiagram\n  autonumber 100 10\n  A ->> B: a reasonably long label",
    );
    const span =
      diagram.participants[1].centerX - diagram.participants[0].centerX;
    const label = measureLabel(
      ["100. a reasonably long label"],
      DIAGRAM_FONT_SIZE,
    );
    expect(span).toBeGreaterThanOrEqual(label.width * GAP_LABEL_MARGIN);
  });
});

describe("layoutSequence - fragments", () => {
  it("boxes the rows it spans and nothing else", () => {
    const diagram = lay(
      [
        "sequenceDiagram",
        "  A ->> B: before",
        "  alt yes",
        "    B ->> A: inside",
        "  end",
        "  A ->> B: after",
      ].join("\n"),
    );
    const [box] = diagram.fragments;
    const [before, inside, after] = diagram.messages;
    expect(box.y).toBeGreaterThan(before.points[0].y);
    expect(box.y).toBeLessThan(inside.label.y);
    expect(box.y + box.height).toBeGreaterThan(inside.points[0].y);
    expect(box.y + box.height).toBeLessThan(after.label.y);
  });

  it("insets a nested box inside the one that contains it", () => {
    const diagram = lay(
      [
        "sequenceDiagram",
        "  loop retry",
        "    alt ok",
        "      A ->> B: one",
        "    end",
        "  end",
      ].join("\n"),
    );
    const [outer, inner] = diagram.fragments;
    expect(outer.depth).toBe(0);
    expect(inner.depth).toBe(1);
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.x + inner.width).toBeLessThan(outer.x + outer.width);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(inner.y + inner.height).toBeLessThan(outer.y + outer.height);
  });

  it("returns fragments outermost first, so order is z-order", () => {
    const diagram = lay(
      [
        "sequenceDiagram",
        "  loop a",
        "    alt b",
        "      opt c",
        "        A ->> B: one",
        "      end",
        "    end",
        "  end",
      ].join("\n"),
    );
    expect(diagram.fragments.map((f) => f.depth)).toEqual([0, 1, 2]);
  });

  it("puts a divider between the branches it separates", () => {
    const diagram = lay(
      [
        "sequenceDiagram",
        "  alt yes",
        "    A ->> B: one",
        "  else no",
        "    B ->> A: two",
        "  end",
      ].join("\n"),
    );
    const [box] = diagram.fragments;
    const [one, two] = diagram.messages;
    expect(box.dividers).toHaveLength(1);
    expect(box.dividers[0].label).toBe("no");
    expect(box.dividers[0].y).toBeGreaterThan(one.points[0].y);
    expect(box.dividers[0].y).toBeLessThan(two.label.y);
  });

  it("draws a box wide enough to cover the lifelines it spans", () => {
    const diagram = lay(
      "sequenceDiagram\n  alt yes\n    A ->> C: one\n  end\n  B ->> C: two",
    );
    const [box] = diagram.fragments;
    for (const participant of diagram.participants) {
      expect(box.x).toBeLessThan(participant.centerX);
      expect(box.x + box.width).toBeGreaterThan(participant.centerX);
    }
  });

  it("keeps the box inside the diagram", () => {
    const diagram = lay(
      "sequenceDiagram\n  opt maybe\n    A ->> B: one\n  end",
    );
    const [box] = diagram.fragments;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(diagram.width);
    expect(box.y + box.height).toBeLessThanOrEqual(diagram.height);
  });

  it("carries a tab big enough for its own kind", () => {
    const [box] = lay(
      "sequenceDiagram\n  loop retry\n    A ->> B: one\n  end",
    ).fragments;
    expect(box.kind).toBe("loop");
    expect(box.label).toBe("retry");
    expect(box.tabWidth).toBeGreaterThan(measureLabel(["loop"]).width);
    expect(box.tabHeight).toBeGreaterThan(0);
  });
});

describe("layoutSequence - caps", () => {
  it("refuses a diagram past the participant cap", () => {
    const lines = ["sequenceDiagram"];
    for (let i = 0; i <= MAX_SEQUENCE_PARTICIPANTS; i++)
      lines.push(`  P${i} ->> P${i}: x`);
    const model = parseSequence(lines.join("\n"));
    if (!model) throw new Error("source did not parse");
    expect(model.participants.length).toBeGreaterThan(
      MAX_SEQUENCE_PARTICIPANTS,
    );
    expect(layoutSequence(model)).toBeUndefined();
  });

  it("lays out a diagram exactly at the participant cap", () => {
    const lines = ["sequenceDiagram"];
    for (let i = 0; i < MAX_SEQUENCE_PARTICIPANTS; i++)
      lines.push(`  P${i} ->> P${i}: x`);
    const model = parseSequence(lines.join("\n"));
    if (!model) throw new Error("source did not parse");
    expect(layoutSequence(model)).toBeDefined();
  });

  it("refuses a diagram past the row cap", () => {
    const lines = ["sequenceDiagram"];
    for (let i = 0; i <= MAX_SEQUENCE_MESSAGES; i++) lines.push("  A ->> B: x");
    const model = parseSequence(lines.join("\n"));
    if (!model) throw new Error("source did not parse");
    expect(layoutSequence(model)).toBeUndefined();
  });

  it("counts a note as a row against the cap", () => {
    const lines = ["sequenceDiagram", "  A ->> B: x"];
    for (let i = 0; i < MAX_SEQUENCE_MESSAGES; i++)
      lines.push("  Note over A: n");
    const model = parseSequence(lines.join("\n"));
    if (!model) throw new Error("source did not parse");
    expect(layoutSequence(model)).toBeUndefined();
  });
});
