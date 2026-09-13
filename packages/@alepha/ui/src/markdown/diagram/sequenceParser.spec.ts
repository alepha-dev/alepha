import { describe, expect, it } from "vitest";

import type { SequenceMessage, SequenceNote } from "./sequenceModel.ts";
import { parseSequence } from "./sequenceParser.ts";

const parse = (source: string) => {
  const model = parseSequence(source);
  if (!model) throw new Error("expected the source to parse");
  return model;
};

const messages = (source: string): SequenceMessage[] =>
  parse(source).steps.filter(
    (step): step is SequenceMessage => step.kind === "message",
  );

const notes = (source: string): SequenceNote[] =>
  parse(source).steps.filter(
    (step): step is SequenceNote => step.kind === "note",
  );

const messageOf = (source: string, index = 0) => messages(source)[index];

describe("parseSequence - header and preamble", () => {
  it("reads a bare sequenceDiagram header", () => {
    expect(parse("sequenceDiagram\n  A ->> B: hi").steps).toHaveLength(1);
  });

  it("returns undefined for a diagram type outside the subset", () => {
    expect(parseSequence("flowchart TD\n  A --> B")).toBeUndefined();
  });

  it("returns undefined when nothing was declared", () => {
    expect(parseSequence("sequenceDiagram")).toBeUndefined();
  });

  it("returns undefined for a diagram with participants but no steps", () => {
    expect(parseSequence("sequenceDiagram\n  participant A")).toBeUndefined();
  });

  it("skips a YAML frontmatter block", () => {
    expect(
      parse("---\ntitle: X\n---\nsequenceDiagram\n  A ->> B: hi").participants,
    ).toHaveLength(2);
  });

  it("skips an init directive", () => {
    expect(
      parse('%%{init: {"theme":"dark"}}%%\nsequenceDiagram\n  A ->> B: hi')
        .steps,
    ).toHaveLength(1);
  });

  it("drops %% comments", () => {
    const model = parse(
      "sequenceDiagram\n  %% a comment\n  A ->> B: hi %% trailing",
    );
    expect(model.steps).toHaveLength(1);
    expect((model.steps[0] as SequenceMessage).lines).toEqual(["hi"]);
  });
});

describe("parseSequence - participants", () => {
  it("declares participants explicitly, in order", () => {
    expect(
      parse(
        "sequenceDiagram\n  participant B\n  participant A\n  A ->> B: hi",
      ).participants.map((p) => p.id),
    ).toEqual(["B", "A"]);
  });

  it("reads an as alias as the label", () => {
    const [alice] = parse(
      "sequenceDiagram\n  participant A as Alice Smith\n  A ->> A: hi",
    ).participants;
    expect(alice.id).toBe("A");
    expect(alice.lines).toEqual(["Alice Smith"]);
  });

  it("keeps actor apart from participant", () => {
    const model = parse(
      "sequenceDiagram\n  actor U\n  participant S\n  U ->> S: hi",
    );
    expect(model.participants.map((p) => p.actor)).toEqual([true, false]);
  });

  it("declares participants implicitly, in order of first appearance", () => {
    expect(
      parse("sequenceDiagram\n  A ->> B: one\n  C ->> A: two").participants.map(
        (p) => p.id,
      ),
    ).toEqual(["A", "B", "C"]);
  });

  it("uses the bare id as the label when there is no alias", () => {
    expect(
      parse("sequenceDiagram\n  A ->> B: hi").participants[0].lines,
    ).toEqual(["A"]);
  });

  it("lets a later declaration name a participant a message introduced", () => {
    const model = parse(
      "sequenceDiagram\n  A ->> B: hi\n  participant A as Alice",
    );
    expect(model.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(model.participants[0].lines).toEqual(["Alice"]);
  });

  it("splits a participant label on <br/>", () => {
    expect(
      parse("sequenceDiagram\n  participant A as Auth<br/>Worker\n  A ->> A: x")
        .participants[0].lines,
    ).toEqual(["Auth", "Worker"]);
  });
});

describe("parseSequence - arrows", () => {
  const cases: Array<[string, string, string]> = [
    ["->", "solid", "none"],
    ["-->", "dashed", "none"],
    ["->>", "solid", "arrow"],
    ["-->>", "dashed", "arrow"],
    ["-x", "solid", "cross"],
    ["--x", "dashed", "cross"],
    ["-)", "solid", "open"],
    ["--)", "dashed", "open"],
  ];

  for (const [arrow, line, head] of cases) {
    it(`reads ${arrow} as a ${line} line with a ${head} head`, () => {
      const message = messageOf(`sequenceDiagram\n  A ${arrow} B: hi`);
      expect(message.line).toBe(line);
      expect(message.head).toBe(head);
    });
  }

  it("reads an arrow written without surrounding spaces", () => {
    const message = messageOf("sequenceDiagram\n  A-->>B: hi");
    expect(message.from).toBe("A");
    expect(message.to).toBe("B");
    expect(message.head).toBe("arrow");
  });

  it("parses and discards the + activation suffix", () => {
    const message = messageOf("sequenceDiagram\n  A ->>+ B: hi");
    expect(message.to).toBe("B");
    expect(message.head).toBe("arrow");
  });

  it("parses and discards the - activation suffix", () => {
    const message = messageOf("sequenceDiagram\n  A -->>- B: hi");
    expect(message.to).toBe("B");
    expect(message.line).toBe("dashed");
  });

  it("flags a self-message", () => {
    const model = parse("sequenceDiagram\n  A ->> A: retry");
    expect(messages("sequenceDiagram\n  A ->> A: retry")[0].self).toBe(true);
    expect(model.participants).toHaveLength(1);
  });

  it("does not flag a normal message as a self-message", () => {
    expect(messageOf("sequenceDiagram\n  A ->> B: hi").self).toBe(false);
  });
});

describe("parseSequence - labels", () => {
  it("does not re-split a label containing an arrow", () => {
    const message = messageOf("sequenceDiagram\n  A ->> B: maps -> onto");
    expect(message.from).toBe("A");
    expect(message.to).toBe("B");
    expect(message.lines).toEqual(["maps -> onto"]);
  });

  it("keeps a colon inside the label", () => {
    expect(messageOf("sequenceDiagram\n  A ->> B: key: value").lines).toEqual([
      "key: value",
    ]);
  });

  it("splits a message label on <br/>", () => {
    expect(messageOf("sequenceDiagram\n  A ->> B: one<br/>two").lines).toEqual([
      "one",
      "two",
    ]);
  });

  it("accepts an empty label", () => {
    expect(messageOf("sequenceDiagram\n  A ->> B:").lines).toEqual([""]);
  });

  it("does not read a hyphenated id as an arrow", () => {
    const message = messageOf("sequenceDiagram\n  my-service ->> db: query");
    expect(message.from).toBe("my-service");
    expect(message.to).toBe("db");
  });

  it("does not read an id ending in -x as a cross arrow", () => {
    const message = messageOf("sequenceDiagram\n  my-x ->> B: hi");
    expect(message.from).toBe("my-x");
    expect(message.head).toBe("arrow");
  });

  it("skips a message with no colon", () => {
    expect(parseSequence("sequenceDiagram\n  A ->> B")).toBeUndefined();
  });
});

describe("parseSequence - notes", () => {
  it("reads a note over one participant", () => {
    const [note] = notes(
      "sequenceDiagram\n  A ->> B: hi\n  Note over A: think",
    );
    expect(note.placement).toBe("over");
    expect(note.participants).toEqual(["A"]);
    expect(note.lines).toEqual(["think"]);
  });

  it("reads a note spanning two participants", () => {
    const [note] = notes(
      "sequenceDiagram\n  A ->> B: hi\n  Note over A,B: shared",
    );
    expect(note.participants).toEqual(["A", "B"]);
  });

  it("reads left of and right of", () => {
    const placed = notes(
      "sequenceDiagram\n  A ->> B: hi\n  Note left of A: l\n  Note right of B: r",
    );
    expect(placed.map((n) => n.placement)).toEqual(["left", "right"]);
  });

  it("keeps a note in source order among the messages", () => {
    const model = parse(
      "sequenceDiagram\n  A ->> B: one\n  Note over B: think\n  B ->> A: two",
    );
    expect(model.steps.map((s) => s.kind)).toEqual([
      "message",
      "note",
      "message",
    ]);
  });

  it("splits a note label on <br/>", () => {
    expect(
      notes("sequenceDiagram\n  A ->> B: hi\n  Note over A: one<br/>two")[0]
        .lines,
    ).toEqual(["one", "two"]);
  });

  it("accepts a note above the message that declares its participant", () => {
    expect(
      notes("sequenceDiagram\n  Note over A: early\n  A ->> B: hi"),
    ).toHaveLength(1);
  });

  it("refuses a note naming a participant that appears nowhere", () => {
    expect(
      parseSequence("sequenceDiagram\n  A ->> B: hi\n  Note over Z: ghost"),
    ).toBeUndefined();
  });
});

describe("parseSequence - autonumber", () => {
  it("is absent unless declared", () => {
    expect(parse("sequenceDiagram\n  A ->> B: hi").autonumber).toBeUndefined();
  });

  it("defaults to 1, 1", () => {
    expect(
      parse("sequenceDiagram\n  autonumber\n  A ->> B: hi").autonumber,
    ).toEqual({ start: 1, step: 1 });
  });

  it("reads a start", () => {
    expect(
      parse("sequenceDiagram\n  autonumber 10\n  A ->> B: hi").autonumber,
    ).toEqual({ start: 10, step: 1 });
  });

  it("reads a start and a step", () => {
    expect(
      parse("sequenceDiagram\n  autonumber 10 10\n  A ->> B: hi").autonumber,
    ).toEqual({ start: 10, step: 10 });
  });

  it("turns off again", () => {
    expect(
      parse("sequenceDiagram\n  autonumber\n  autonumber off\n  A ->> B: hi")
        .autonumber,
    ).toBeUndefined();
  });
});

describe("parseSequence - fragments", () => {
  it("spans the steps inside an alt, with its else divider", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  A ->> B: ask",
        "  alt known",
        "    B ->> A: yes",
        "  else unknown",
        "    B ->> A: no",
        "  end",
        "  A ->> B: bye",
      ].join("\n"),
    );
    expect(model.fragments).toHaveLength(1);
    const [alt] = model.fragments;
    expect(alt.kind).toBe("alt");
    expect(alt.label).toBe("known");
    expect(alt.from).toBe(1);
    expect(alt.to).toBe(2);
    expect(alt.depth).toBe(0);
    expect(alt.dividers).toEqual([{ at: 2, label: "unknown" }]);
  });

  it("reads opt and loop", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  opt cached",
        "    A ->> B: hit",
        "  end",
        "  loop every 5s",
        "    A ->> B: poll",
        "  end",
      ].join("\n"),
    );
    expect(model.fragments.map((f) => f.kind)).toEqual(["opt", "loop"]);
    expect(model.fragments[1].label).toBe("every 5s");
  });

  it("nests fragments and counts the depth", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  loop retry",
        "    alt ok",
        "      A ->> B: one",
        "    end",
        "  end",
      ].join("\n"),
    );
    expect(model.fragments.map((f) => `${f.kind}:${f.depth}`)).toEqual([
      "loop:0",
      "alt:1",
    ]);
    expect(model.fragments.map((f) => `${f.from}-${f.to}`)).toEqual([
      "0-0",
      "0-0",
    ]);
  });

  it("drops a fragment that encloses nothing", () => {
    const model = parse("sequenceDiagram\n  A ->> B: hi\n  opt nothing\n  end");
    expect(model.fragments).toEqual([]);
  });

  it("keeps an else that opens the box, so an empty first branch reads as one", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  alt yes",
        "  else no",
        "    A ->> B: one",
        "  end",
      ].join("\n"),
    );
    expect(model.fragments[0].dividers).toEqual([{ at: 0, label: "no" }]);
  });

  it("drops an else that introduces nothing", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  alt yes",
        "    A ->> B: one",
        "  else no",
        "  end",
      ].join("\n"),
    );
    expect(model.fragments[0].dividers).toEqual([]);
  });

  it("refuses an end with no open fragment", () => {
    expect(
      parseSequence("sequenceDiagram\n  A ->> B: hi\n  end"),
    ).toBeUndefined();
  });

  it("refuses a fragment that is never closed", () => {
    expect(
      parseSequence("sequenceDiagram\n  alt open\n    A ->> B: hi"),
    ).toBeUndefined();
  });

  it("refuses an else outside an alt", () => {
    expect(
      parseSequence(
        "sequenceDiagram\n  loop x\n    A ->> B: hi\n  else no\n  end",
      ),
    ).toBeUndefined();
  });

  it("refuses a bare else", () => {
    expect(
      parseSequence("sequenceDiagram\n  A ->> B: hi\n  else no"),
    ).toBeUndefined();
  });
});

describe("parseSequence - refuse vs skip", () => {
  for (const construct of ["par", "critical", "break", "create", "destroy"]) {
    it(`refuses the whole diagram on ${construct}`, () => {
      expect(
        parseSequence(
          `sequenceDiagram\n  A ->> B: hi\n  ${construct} x\n    A ->> B: two\n  end`,
        ),
      ).toBeUndefined();
    });
  }

  it("skips activate and deactivate", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  A ->> B: hi",
        "  activate B",
        "  B ->> A: bye",
        "  deactivate B",
      ].join("\n"),
    );
    expect(model.steps).toHaveLength(2);
  });

  it("skips a rect block and consumes its end", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  rect rgb(200, 200, 255)",
        "    A ->> B: inside",
        "  end",
        "  A ->> B: after",
      ].join("\n"),
    );
    expect(model.steps).toHaveLength(2);
    expect(model.fragments).toEqual([]);
  });

  it("skips a box group and consumes its end", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  box Aqua Edge",
        "    participant A",
        "    participant B",
        "  end",
        "  A ->> B: hi",
      ].join("\n"),
    );
    expect(model.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(model.steps).toHaveLength(1);
  });

  it("skips links, link, menu and style", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  A ->> B: hi",
        "  links A: {'Dash': 'https://x'}",
        "  link A: Dash @ https://x",
        "  style A fill:#f00",
      ].join("\n"),
    );
    expect(model.steps).toHaveLength(1);
  });

  it("skips a rect inside a fragment without disturbing the box", () => {
    const model = parse(
      [
        "sequenceDiagram",
        "  alt yes",
        "    rect rgb(0,0,0)",
        "      A ->> B: one",
        "    end",
        "  end",
      ].join("\n"),
    );
    expect(model.fragments).toHaveLength(1);
    expect(model.fragments[0].depth).toBe(0);
    expect(model.fragments[0].to).toBe(0);
  });
});
