import { describe, expect, it } from "vitest";

import {
  type ReleaseBumpSubject,
  releaseBumps,
  suggestedReleaseTag,
} from "./releaseBumps.ts";

const RELEASED = "2026-09-01T10:00:00.000Z";

/**
 * A release as the rule reads it. `number` is the creation order, so a
 * fixture lists releases in the order they were created.
 */
const release = (
  number: number,
  tag: string,
  released = false,
): ReleaseBumpSubject => ({
  number,
  tag,
  releasedAt: released ? RELEASED : undefined,
});

/**
 * Every row's offers, keyed by tag, with the rows that offer nothing left
 * out so an assertion names only what is offered.
 */
const offers = (all: ReleaseBumpSubject[]): Record<string, string[]> =>
  Object.fromEntries(
    all
      .map((it) => [
        it.tag ?? `#${it.number}`,
        releaseBumps(it, all).map((bump) => bump.tag),
      ])
      .filter(([, tags]) => tags.length > 0),
  );

/**
 * Project 1 when the epic was planned: two releases shipped, the next one
 * open and the default, and a far-future `1.0.0` planned early.
 */
const PROJECT_1 = [
  release(1, "0.28.0", true),
  release(2, "1.0.0"),
  release(3, "0.29.0", true),
  release(4, "0.30.0"),
];

describe("releaseBumps", () => {
  it("offers each line's next version from its frontier row only", () => {
    expect(offers(PROJECT_1)).toEqual({
      "0.28.0": ["0.28.1"],
      "0.29.0": ["0.29.1"],
      "0.30.0": ["0.31.0"],
      "1.0.0": ["1.1.0", "2.0.0"],
    });
  });

  it("names each entry's kind, in patch, minor, major order", () => {
    const all = [release(1, "1.0.0", true)];

    expect(releaseBumps(all[0], all)).toEqual([
      { kind: "patch", tag: "1.0.1" },
      { kind: "minor", tag: "1.1.0" },
      { kind: "major", tag: "2.0.0" },
    ]);
  });

  it("still offers 0.31.0 once 0.30.0 is published, now beside its patch", () => {
    // The case a state-gated rule got wrong: with 0.30.0 shipped, the only
    // open row is 1.0.0, and nothing open offers the release created next.
    const all = PROJECT_1.map((it) =>
      it.tag === "0.30.0" ? { ...it, releasedAt: RELEASED } : it,
    );

    expect(offers(all)).toEqual({
      "0.28.0": ["0.28.1"],
      "0.29.0": ["0.29.1"],
      "0.30.0": ["0.30.1", "0.31.0"],
      "1.0.0": ["1.1.0", "2.0.0"],
    });
  });

  it("offers nothing from a named tag, and lets it change nothing else", () => {
    // `compareReleaseTags` sorts demo-1 after every version, so ordered
    // before filtering it would be the highest release and no row would
    // offer a major.
    const all = [...PROJECT_1, release(5, "demo-1", true)];

    expect(offers(all)).toEqual(offers(PROJECT_1));
    expect(releaseBumps(all[4], all)).toEqual([]);
  });

  it("offers nothing from a release with no tag", () => {
    const all = [...PROJECT_1, { number: 5, tag: undefined }];

    expect(releaseBumps(all[4], all)).toEqual([]);
    expect(offers(all)).toEqual(offers(PROJECT_1));
  });

  it("keeps the row's v prefix, byte for byte", () => {
    const lower = [release(1, "v1.0.0")];
    const upper = [release(1, "V1.0.0")];

    expect(offers(lower)).toEqual({ "v1.0.0": ["v1.1.0", "v2.0.0"] });
    expect(offers(upper)).toEqual({ "V1.0.0": ["V1.1.0", "V2.0.0"] });
  });

  it("normalises a short tag to three segments", () => {
    const two = [release(1, "1.0", true)];
    const one = [release(1, "2")];

    expect(offers(two)).toEqual({ "1.0": ["1.0.1", "1.1.0", "2.0.0"] });
    expect(offers(one)).toEqual({ "2": ["2.1.0", "3.0.0"] });
  });

  it("offers nothing from four segments, and lets them block nothing", () => {
    // 1.2.3.4 would be the frontier of major 1 if it took part, silencing
    // 1.0.0's minor and major.
    const all = [release(1, "1.0.0"), release(2, "1.2.3.4", true)];

    expect(offers(all)).toEqual({ "1.0.0": ["1.1.0", "2.0.0"] });
  });

  it("gives a tie to the release created last, so exactly one row offers", () => {
    const all = [release(1, "1.0.0"), release(2, "v1.0.0")];

    expect(offers(all)).toEqual({ "v1.0.0": ["v1.1.0", "v2.0.0"] });
  });

  it("gives a tie between 1.0 and 1.0.0 to the later one as well", () => {
    const all = [release(1, "1.0.0", true), release(2, "1.0", true)];

    expect(offers(all)).toEqual({ "1.0": ["1.0.1", "1.1.0", "2.0.0"] });
  });

  it("never offers a tag the project already has", () => {
    // The frontier makes a collision impossible over candidates; this is the
    // assertion that stands in for checking it in the code.
    const fixtures: ReleaseBumpSubject[][] = [
      PROJECT_1,
      PROJECT_1.map((it) => ({ ...it, releasedAt: RELEASED })),
      [...PROJECT_1, release(5, "demo-1", true)],
      [release(1, "v1.0.0"), release(2, "1.0", true), release(3, "2")],
      [release(1, "1.0.0"), release(2, "1.2.3.4", true)],
      [release(1, "1.0.0"), release(2, "v1.0.0")],
      [release(1, "1.0.0", true), release(2, "1.0", true)],
      [
        release(1, "0.1.0", true),
        release(2, "0.1.1", true),
        release(3, "0.2.0", true),
        release(4, "0.1.2", true),
        release(5, "1.0.0", true),
        release(6, "0.3.0"),
      ],
    ];

    for (const all of fixtures) {
      const tags = new Set(all.map((it) => it.tag));
      for (const row of all) {
        for (const bump of releaseBumps(row, all)) {
          expect(tags.has(bump.tag), `${row.tag} offers ${bump.tag}`).toBe(
            false,
          );
        }
      }
    }
  });
});

describe("suggestedReleaseTag", () => {
  it("suggests the next minor of the highest released major", () => {
    // Anchored on 0.29.0, the highest shipped release, and not on the
    // far-future 1.0.0: the frontier of major 0 is 0.30.0.
    expect(suggestedReleaseTag(PROJECT_1)).toBe("0.31.0");
  });

  it("suggests nothing for an empty project", () => {
    expect(suggestedReleaseTag([])).toBeUndefined();
  });

  it("suggests nothing when every tag is named", () => {
    expect(
      suggestedReleaseTag([release(1, "demo-1", true), release(2, "RC1")]),
    ).toBeUndefined();
  });

  it("falls back to the highest release when nothing has shipped", () => {
    expect(
      suggestedReleaseTag([release(1, "0.1.0"), release(2, "1.0.0")]),
    ).toBe("1.1.0");
  });
});
