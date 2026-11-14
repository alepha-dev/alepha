import { describe, it } from "vitest";

import { RetiredWordsRule } from "./retired-words-rule.ts";

const rule = new RetiredWordsRule();

describe("RetiredWordsRule", () => {
  it("refuses the retired words in code, prose and identifiers", ({
    expect,
  }) => {
    const found = rule.check(
      "lore/packages/@lore/deploy/src/api/Thing.ts",
      [
        "// Resolves a blight.",
        'const kind = "estate";',
        "class EstateService {}",
        "const openBlights = 1;",
      ].join("\n"),
    );

    expect(found).toHaveLength(4);
    expect(found[0]).toMatch(/Thing\.ts:1: /);
  });

  it("is word-bounded, so useState and restate are not estates", ({
    expect,
  }) => {
    expect(
      rule.check(
        "lore/src/Page.tsx",
        "const [value, setValue] = useState(0); // restate the interstate",
      ),
    ).toEqual([]);
  });

  it("lets history and the frozen wire fixtures say anything", ({ expect }) => {
    for (const file of [
      "framework/CHANGELOG.md",
      "lore/apps/lore/migrations/sqlite/20261114004743_estates_become_hosts/migration.sql",
      "bay/internal/connector/testdata/wire-v1/welcome.json",
      "lore/packages/@lore/deploy/test/fixtures/bay/wire-v1/config.json",
      "lore/apps/lore/test/estates-become-hosts-migration.spec.ts",
    ]) {
      expect(rule.check(file, "estates and blights")).toEqual([]);
    }
  });

  it("lets a line through when it carries Bay's wire v1 or a stored name", ({
    expect,
  }) => {
    expect(
      rule.check(
        "bay/internal/connector/config.go",
        [
          'const SocketPath = "/ws/estates"',
          'const SecretPrefix = "est_"',
          '\tHostID string `json:"estateId"`',
          '  public static readonly HOST_PURPOSE = "lore:estates:v1";',
          "  blights: z.boolean().default(true),",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not let the allowlist excuse another word on another line", ({
    expect,
  }) => {
    expect(
      rule.check(
        "bay/docs/guide.md",
        'The socket is "/ws/estates".\nEnrol the estate first.',
      ),
    ).toEqual(["bay/docs/guide.md:2: Enrol the estate first."]);
  });
});
