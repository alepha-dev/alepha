import { Alepha } from "alepha";
import { cliOptions } from "alepha/command";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, test } from "vitest";

import {
  ChangelogCommand,
  changelogOptions,
  GitMessageParser,
  GitProvider,
} from "../commands/gen/changelog.ts";

// =============================================================================
// MOCK GIT PROVIDER
// =============================================================================

let currentMockResponses: Map<string, string> | null = null;

class MockGitProvider extends GitProvider {
  override async exec(args: string[], _cwd: string): Promise<string> {
    if (!currentMockResponses) {
      throw new Error("No git mocks configured");
    }
    const cmd = args.join(" ");
    const response = currentMockResponses.get(cmd);
    if (response === undefined) {
      throw new Error(`Unmocked git command: ${cmd}`);
    }
    return response;
  }
}

/**
 * What `git log --pretty=format:%h %s%n%b%x1e` actually emits.
 *
 * Each commit is `<subject>\n<body>\x1e`, and git joins the entries with a
 * newline — so every record after the first arrives with a leading one.
 * Built here rather than written inline because the leading newline is
 * exactly the detail a hand-written fixture drops, and dropping it makes
 * every record after the first unparseable.
 */
function gitLog(
  entries: Array<string | { line: string; body: string }>,
): string {
  return entries
    .map((entry) =>
      typeof entry === "string"
        ? `${entry}\n\x1e`
        : `${entry.line}\n${entry.body}\x1e`,
    )
    .join("\n");
}

function setMockGitResponses(
  mocks: Array<{ cmd: string; response: string }>,
): void {
  currentMockResponses = new Map<string, string>();
  for (const { cmd, response } of mocks) {
    currentMockResponses.set(cmd, response);
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe("changelog", () => {
  describe("GitMessageParser.parseCommit", () => {
    const defaultConfig = { ignore: ["chore", "ci", "build", "test"] };

    const getParser = () => {
      const alepha = Alepha.create();
      return alepha.inject(GitMessageParser);
    };

    test("should parse conventional commit with scope", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "abc12345 feat(ui): add button component",
        defaultConfig,
      );

      expect(result).toEqual({
        hash: "abc12345",
        type: "feat",
        scope: "ui",
        description: "add button component",
        breaking: false,
        breakingNotes: [],
      });
    });

    test("should ignore conventional commit without scope", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "def45678 fix: resolve memory leak",
        defaultConfig,
      );
      expect(result).toBeNull();
    });

    test("should detect breaking change with ! marker", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "aaa78901 feat(api)!: remove deprecated endpoint",
        defaultConfig,
      );

      expect(result).toEqual({
        hash: "aaa78901",
        type: "feat",
        scope: "api",
        description: "remove deprecated endpoint",
        breaking: true,
        breakingNotes: [],
      });
    });

    test("should detect breaking change in description", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "bbb01234 feat(auth): breaking change to token format",
        defaultConfig,
      );

      expect(result).toEqual({
        hash: "bbb01234",
        type: "feat",
        scope: "auth",
        description: "breaking change to token format",
        breaking: true,
        breakingNotes: [],
      });
    });

    /**
     * The body of `04facd519`, verbatim, wrapping and all.
     *
     * The point of using a real one: it is the ONLY commit in 0.27.0..HEAD
     * that declared a break, it uses the bare-heading form rather than the
     * conventional-commits footer, and its items wrap at ~76 columns. A
     * fixture written from the specification instead would have been green
     * against a parser that still missed every break this repository has
     * ever written.
     */
    const realBreakingBody = [
      "Implements epic Notifications v2 (#6) in full: all eleven quests.",
      "",
      "Breaking changes",
      "- the admin notification list is backed by receipts, so notifications",
      "  pushed before this have none and do not appear",
      "- notificationQuerySchema.status changes from the job vocabulary to the",
      "  receipt one",
      "- notificationContactSchema is deleted and",
      "  notificationContactPreferencesSchema is rewritten onto two axes",
      "- the notification $parameter is renamed to api.notifications and the realm",
      "  settings $parameter to api.realms.<realm>; both are keyed by name, so",
      "  stored overrides are orphaned and revert to defaults",
      "",
      "Also fixes JobProvider.pushMany dropping options on its keyed path, which",
      "lost the tenant on every keyed row.",
    ].join("\n");

    test("should detect a bare 'Breaking changes' heading in the body", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        `04facd51 feat(api): delivery hygiene, receipts and React email templates\n${realBreakingBody}`,
        { ...defaultConfig, scopes: undefined },
      );

      expect(result?.breaking).toBe(true);
      // Four items, not five lines: each wrapped bullet is one item.
      expect(result?.breakingNotes).toHaveLength(4);
      expect(result?.breakingNotes[0]).toBe(
        "the admin notification list is backed by receipts, so notifications pushed before this have none and do not appear",
      );
      // Reading stops at the blank line, so the paragraph after the list is
      // not mistaken for a fifth break.
      expect(result?.breakingNotes.join(" ")).not.toContain("pushMany");
    });

    test("should detect the conventional-commits footer", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        [
          "eee11111 feat(api): rework the token format",
          "Some ordinary prose about the change.",
          "",
          "BREAKING CHANGE: tokens minted before this no longer verify",
        ].join("\n"),
        defaultConfig,
      );

      expect(result?.breaking).toBe(true);
      expect(result?.breakingNotes).toEqual([
        "tokens minted before this no longer verify",
      ]);
    });

    test("should leave an ordinary body alone", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        [
          "fff22222 feat(api): add an endpoint",
          "A body that talks about breaking down the work into steps.",
        ].join("\n"),
        defaultConfig,
      );

      // The word appears, but not as a marker: a body that merely mentions
      // breaking something up must not flag the release.
      expect(result?.breaking).toBe(false);
      expect(result?.breakingNotes).toEqual([]);
    });

    test("should ignore commits with ignored scope", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "ccc34567 feat(chore): update deps",
        defaultConfig,
      );
      expect(result).toBeNull();
    });

    test("should ignore commits with nested ignored scope", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "ddd67890 feat(test/unit): add tests",
        defaultConfig,
      );
      expect(result).toBeNull();
    });

    test("should ignore module-style commits (no type)", () => {
      const parser = getParser();
      const result = parser.parseCommit("eee90123 cli: add new command", {});
      expect(result).toBeNull();
    });

    test("should return null for non-matching commits", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "fff78901 random commit message",
        defaultConfig,
      );
      expect(result).toBeNull();
    });

    test("should truncate hash to 8 characters", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "abcdef1234567890 feat(core): something",
        defaultConfig,
      );
      expect(result?.hash).toBe("abcdef12");
    });

    test("should parse the default types", () => {
      const parser = getParser();

      for (const type of ["feat", "fix"]) {
        const result = parser.parseCommit(
          `abc12345 ${type}(core): test`,
          defaultConfig,
        );
        expect(result?.type).toBe(type);
      }
    });

    test("should refuse types that are not configured", () => {
      // These used to parse and were then dropped by the command, so a `perf`
      // commit vanished between the two with nothing to show for it.
      const parser = getParser();

      for (const type of ["docs", "refactor", "perf", "revert", "chore"]) {
        const result = parser.parseCommit(
          `abc12345 ${type}(core): test`,
          defaultConfig,
        );
        expect(result).toBeNull();
      }
    });

    test("should parse a type once it is configured", () => {
      const parser = getParser();
      const result = parser.parseCommit("abc12345 perf(orm): faster reads", {
        types: ["feat", "fix", "perf"],
      });

      expect(result?.type).toBe("perf");
    });

    test("should handle nested scopes", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "abc12345 feat(api/users): add endpoint",
        defaultConfig,
      );

      expect(result).toEqual({
        hash: "abc12345",
        type: "feat",
        scope: "api/users",
        description: "add endpoint",
        breaking: false,
        breakingNotes: [],
      });
    });

    describe("scope allowlist", () => {
      const allowed = { scopes: ["orm", "api"] };

      test("should keep an allowed scope", () => {
        const parser = getParser();
        const result = parser.parseCommit(
          "abc12345 fix(orm): a real fix",
          allowed,
        );
        expect(result?.scope).toBe("orm");
      });

      test("should drop a scope that is not listed", () => {
        const parser = getParser();
        const result = parser.parseCommit(
          "abc12345 fix(lore): internal app work",
          allowed,
        );
        expect(result).toBeNull();
      });

      test("should match a nested scope on its base", () => {
        const parser = getParser();
        const result = parser.parseCommit(
          "abc12345 feat(api/users): add endpoint",
          allowed,
        );
        expect(result?.scope).toBe("api/users");
      });

      test("should keep only the allowed half of a multi-scope commit", () => {
        // Judging the raw string let every one of these through: "orm,lore"
        // matches no entry in any list, whichever way the list is meant.
        const parser = getParser();
        const result = parser.parseCommit(
          "abc12345 fix(orm,lore): touched both",
          allowed,
        );
        expect(result?.scope).toBe("orm");
      });

      test("should drop a multi-scope commit with nothing allowed", () => {
        const parser = getParser();
        const result = parser.parseCommit(
          "abc12345 fix(lore,bay): two internal apps",
          allowed,
        );
        expect(result).toBeNull();
      });

      test("should win over the ignore list when both are set", () => {
        const parser = getParser();
        const result = parser.parseCommit("abc12345 fix(orm): a real fix", {
          scopes: ["orm"],
          ignore: ["orm"],
        });
        expect(result?.scope).toBe("orm");
      });
    });

    test("should drop only the ignored half of a multi-scope commit", () => {
      const parser = getParser();
      const result = parser.parseCommit(
        "abc12345 fix(core,internal): touched both",
        { ignore: ["internal"] },
      );
      expect(result?.scope).toBe("core");
    });
  });

  describe("changelogOptions atom", () => {
    test("should have default ignore list", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const config = alepha.store.get(changelogOptions);
      expect(config.ignore).toContain("chore");
      expect(config.ignore).toContain("ci");
      expect(config.ignore).toContain("build");
      expect(config.ignore).toContain("test");
    });

    test("should allow custom configuration", async () => {
      const alepha = Alepha.create();
      alepha.set(changelogOptions, {
        ignore: ["custom", "internal"],
      });
      await alepha.start();

      const config = alepha.store.get(changelogOptions);
      expect(config.ignore).toEqual(["custom", "internal"]);
    });

    test("should default to feat and fix", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const config = alepha.store.get(changelogOptions);
      expect(config.types).toEqual(["feat", "fix"]);
    });

    test("should have no scope allowlist by default", async () => {
      // Unset means "publish every scope": this command ships to every Alepha
      // app, and their scopes are not ours to guess.
      const alepha = Alepha.create();
      await alepha.start();

      const config = alepha.store.get(changelogOptions);
      expect(config.scopes).toBeUndefined();
    });
  });

  describe("sections", () => {
    class TestChangelogCommand extends ChangelogCommand {
      public testParse = this.parseCommits.bind(this);
      public testFormat = this.formatEntry.bind(this);
    }

    const render = async (
      log: Array<string | { line: string; body: string }>,
      options?: object,
    ) => {
      const alepha = Alepha.create();
      if (options) {
        alepha.set(changelogOptions, options as any);
      }
      const command = alepha.inject(TestChangelogCommand);
      await alepha.start();

      return command.testFormat(command.testParse(gitLog(log)));
    };

    test("should put breaking changes above everything, with their prose", async () => {
      const output = await render([
        "abc12345 fix(orm): a fix",
        {
          line: "def45678 feat(core): rework the cache layout",
          body: [
            "Breaking changes",
            "- the key layout changed, so deploying this starts with a cold",
            "  cache",
            "- del() no longer accepts backend storage keys",
          ].join("\n"),
        },
      ]);

      expect(output).toBe(
        [
          "### Breaking Changes\n",
          "- **core**: the key layout changed, so deploying this starts with a cold cache (`def45678`)",
          "- **core**: del() no longer accepts backend storage keys (`def45678`)",
          "",
          "### Features\n",
          "- **core**: rework the cache layout [BREAKING] (`def45678`)",
          "",
          "### Bug Fixes\n",
          "- **orm**: a fix (`abc12345`)",
          "",
        ].join("\n"),
      );
    });

    test("names a `!`-only breaking change by its subject", async () => {
      // Nothing to quote: `!` says THAT something broke and never what, so
      // an empty bullet would be worse than repeating the subject.
      const output = await render(["abc12345 feat(core)!: remove the old API"]);

      expect(output).toContain(
        "### Breaking Changes\n\n- **core**: remove the old API (`abc12345`)",
      );
    });

    test("should render features before fixes", async () => {
      const output = await render([
        "abc12345 fix(orm): a fix",
        "def45678 feat(core): a feature",
      ]);

      expect(output).toBe(
        [
          "### Features\n",
          "- **core**: a feature (`def45678`)",
          "",
          "### Bug Fixes\n",
          "- **orm**: a fix (`abc12345`)",
          "",
        ].join("\n"),
      );
    });

    test("should follow the configured type order", async () => {
      const output = await render(
        ["abc12345 fix(orm): a fix", "def45678 feat(core): a feature"],
        { types: ["fix", "feat"] },
      );

      expect(output.indexOf("### Bug Fixes")).toBeLessThan(
        output.indexOf("### Features"),
      );
    });

    test("should title a configured type that has no known heading", async () => {
      const output = await render(["abc12345 spike(orm): try something"], {
        types: ["spike"],
      });

      expect(output).toContain("### Spike");
    });

    test("should publish nothing outside the scope allowlist", async () => {
      const output = await render(
        ["abc12345 feat(lore): internal", "def45678 feat(orm): published"],
        { types: ["feat"], scopes: ["orm"] },
      );

      expect(output).toContain("published");
      expect(output).not.toContain("internal");
    });
  });

  describe("changelog command", () => {
    const setupCommand = async (
      gitMocks: { cmd: string; response: string }[],
      argv: string[] = ["changelog"],
      options?: { ignore?: string[] },
    ) => {
      setMockGitResponses(gitMocks);

      const alepha = Alepha.create()
        .with({
          provide: LogDestinationProvider,
          use: MemoryDestinationProvider,
        })
        .with({ provide: GitProvider, use: MockGitProvider })
        .with(ChangelogCommand);

      alepha.store.mut(cliOptions, (old) => ({
        ...old,
        argv,
      }));

      if (options) {
        alepha.set(changelogOptions, options);
      }

      await alepha.start();

      return {
        alepha,
        logger: alepha.inject(MemoryDestinationProvider),
      };
    };

    test("should show changes since latest tag", async () => {
      await setupCommand([
        { cmd: "tag --sort=-version:refname", response: "1.0.0\n0.9.0\n" },
        {
          cmd: "log 1.0.0..HEAD --pretty=format:%h %s%n%b%x1e",
          response: gitLog([
            "abc12345 feat(ui): add dashboard",
            "def56789 fix(core): resolve crash",
          ]),
        },
      ]);
      // Outputs to stdout - test verifies no error
    });

    test("should show changes from specified version", async () => {
      await setupCommand(
        [
          {
            cmd: "log 0.5.0..HEAD --pretty=format:%h %s%n%b%x1e",
            response: gitLog(["abc12345 feat(api): new feature"]),
          },
        ],
        ["changelog", "--from=0.5.0"],
      );
      // Outputs to stdout - test verifies no error
    });

    test("should handle no tags found", async () => {
      await setupCommand([
        { cmd: "tag --sort=-version:refname", response: "" },
      ]);
      // Should output "No version tags found" - no error
    });

    test("should handle no changes since tag", async () => {
      await setupCommand([
        { cmd: "tag --sort=-version:refname", response: "1.0.0\n" },
        { cmd: "log 1.0.0..HEAD --pretty=format:%h %s%n%b%x1e", response: "" },
      ]);
      // Should output "No changes since 1.0.0" - no error
    });

    test("should filter commits by ignore list", async () => {
      await setupCommand(
        [
          { cmd: "tag --sort=-version:refname", response: "1.0.0\n" },
          {
            cmd: "log 1.0.0..HEAD --pretty=format:%h %s%n%b%x1e",
            response: gitLog([
              "abc12345 feat(ui): add dashboard",
              "def56789 feat(internal): should be filtered",
            ]),
          },
        ],
        ["changelog"],
        { ignore: ["internal"] },
      );
      // "feat(internal)" is filtered out
    });

    test("should use -f alias for --from", async () => {
      await setupCommand(
        [
          {
            cmd: "log 0.8.0..HEAD --pretty=format:%h %s%n%b%x1e",
            response: gitLog(["abc12345 feat(cli): new command"]),
          },
        ],
        ["changelog", "-f=0.8.0"],
      );
      // Outputs to stdout - test verifies no error
    });
  });
});
