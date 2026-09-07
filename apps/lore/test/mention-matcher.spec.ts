import { describe, it } from "vitest";

import { expandCommentReferences } from "../src/web/app/components/project/quest/commentReferences.ts";
import { outsideProtected } from "../src/web/app/components/project/quest/commentReferences.ts";
import { displayName } from "../src/web/app/services/displayName.ts";
import { matchMentions } from "../src/web/app/services/mentions.ts";

/**
 * The roster, built the way BOTH sides have to build it: through
 * `displayName`, which is `username` then the email prefix. A server that
 * assembles it any other way disagrees with the renderer about what `@nfo`
 * even is, which is the failure this whole quest exists to prevent.
 */
const users = [
  { userId: "u-1", username: "nfo", email: "ni@example.com" },
  { userId: "u-2", username: "Fabrice", email: "fab@example.com" },
  { userId: "u-3", username: null, email: "legacy@example.com" },
];

const members = users.map((u) => ({ ...u, name: displayName(u, "") }));

/**
 * What the SERVER does: hold out the four protected shapes, then match.
 * `matchMentions` runs on whatever it is given, so the `outsideProtected`
 * wrapper is not optional and this is the shape every call site copies.
 */
const pinged = (body: string): string[] => {
  const found: string[] = [];
  outsideProtected(body, (segment) => {
    for (const member of matchMentions(segment, members)) {
      if (!found.includes(member.userId)) found.push(member.userId);
    }
    return segment;
  });
  return found;
};

/**
 * What the RENDERER does, read back as the set of handles it linked.
 */
const linked = (body: string): string[] => {
  const rendered = expandCommentReferences(body, {
    projectSlug: "alepha",
    members,
  });
  return [...rendered.matchAll(/\[@([\w.-]+)]\(\/alepha\/settings\/members\)/g)]
    .map((m) => m[1]!.toLowerCase())
    .filter((h, i, all) => all.indexOf(h) === i);
};

/**
 * Every case that has ever been wrong, or would be with a second regex.
 *
 * ⚠️ The corpus IS the deliverable. "Both sides agree" means nothing unless
 * the corpus carries the cases where a naive second implementation diverges.
 */
const CORPUS: Array<{ name: string; body: string; expect: string[] }> = [
  {
    name: "a plain mention",
    body: "hey @nfo, look at this",
    expect: ["nfo"],
  },
  {
    name: "a mention at position zero",
    body: "@nfo you around?",
    expect: ["nfo"],
  },
  {
    name: "a case mismatch against the member's own spelling",
    body: "ping @fabrice please",
    expect: ["fabrice"],
  },
  {
    name: "a handle inside a fenced block",
    body: "look:\n\n```ts\n@nfo({ inject: true })\n```\n\nthat is all",
    expect: [],
  },
  {
    name: "a handle inside an inline code span",
    body: "the decorator is `@nfo` in that file",
    expect: [],
  },
  {
    name: "a handle inside an existing wiki link",
    body: "see [[@nfo]] over there",
    expect: [],
  },
  {
    name: "a handle inside a markdown link target",
    body: "read [the docs](/docs/@nfo) first",
    expect: [],
  },
  {
    name: "an email address, which mentions nobody",
    body: "write to me@example.com about it",
    expect: [],
  },
  {
    name: "a handle nobody owns",
    body: "cc @nobody on this",
    expect: [],
  },
  {
    name: "a legacy member with no username, matched on the email prefix",
    body: "@legacy can you look",
    expect: ["legacy"],
  },
  {
    name: "the same handle twice",
    body: "@nfo and also @nfo",
    expect: ["nfo"],
  },
  {
    name: "two handles, one of them protected",
    body: "@nfo should read `@fabrice` first",
    expect: ["nfo"],
  },
];

const userIdOf = (handle: string) =>
  members.find((m) => m.name.toLowerCase() === handle)!.userId;

describe("the mention matcher", () => {
  for (const entry of CORPUS) {
    it(`agrees on ${entry.name}`, ({ expect }) => {
      const expectedIds = entry.expect.map(userIdOf);

      // The server's answer.
      expect(pinged(entry.body)).toEqual(expectedIds);
      // The renderer's answer, over the same corpus.
      expect(linked(entry.body)).toEqual(entry.expect);
    });
  }

  /**
   * The pattern is global, and a shared `/g` RegExp carries `lastIndex`
   * between calls: two callers would silently skip each other's matches.
   */
  it("does not carry state between calls", ({ expect }) => {
    const body = "@nfo and @fabrice";
    expect(matchMentions(body, members).map((m) => m.userId)).toEqual([
      "u-1",
      "u-2",
    ]);
    expect(matchMentions(body, members).map((m) => m.userId)).toEqual([
      "u-1",
      "u-2",
    ]);
  });

  /**
   * The matcher hands back the CALLER's objects, so the api reaches the
   * email it has to push to without a second lookup by name, which would be
   * a second comparison and therefore a second definition.
   */
  it("returns the caller's own member objects", ({ expect }) => {
    const [found] = matchMentions("hi @nfo", members);
    expect(found).toMatchObject({ userId: "u-1", email: "ni@example.com" });
  });

  it("matches nothing when the project has no members", ({ expect }) => {
    expect(matchMentions("hi @nfo", [])).toEqual([]);
  });
});
