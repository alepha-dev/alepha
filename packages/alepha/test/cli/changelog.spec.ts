import { Alepha } from "alepha";
import {
  ChangelogCommand,
  changelogOptions,
  GitMessageParser,
  GitProvider,
} from "alepha/cli";
import { cliOptions } from "alepha/command";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, test } from "vitest";

// =============================================================================
// MOCK GIT PROVIDER
// =============================================================================

let currentMockResponses: Map<string, string> | null = null;

class MockGitProvider extends GitProvider {
  override async exec(cmd: string, _cwd: string): Promise<string> {
    if (!currentMockResponses) {
      throw new Error("No git mocks configured");
    }
    const response = currentMockResponses.get(cmd);
    if (response === undefined) {
      throw new Error(`Unmocked git command: ${cmd}`);
    }
    return response;
  }
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
      });
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

    test("should parse all supported types", () => {
      const parser = getParser();
      const types = ["feat", "fix", "docs", "refactor", "perf", "revert"];

      for (const type of types) {
        const result = parser.parseCommit(
          `abc12345 ${type}(core): test`,
          defaultConfig,
        );
        expect(result?.type).toBe(type);
      }
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
      });
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
          cmd: "log 1.0.0..HEAD --oneline",
          response: [
            "abc12345 feat(ui): add dashboard",
            "def56789 fix(core): resolve crash",
          ].join("\n"),
        },
      ]);
      // Outputs to stdout - test verifies no error
    });

    test("should show changes from specified version", async () => {
      await setupCommand(
        [
          {
            cmd: "log 0.5.0..HEAD --oneline",
            response: "abc12345 feat(api): new feature",
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
        { cmd: "log 1.0.0..HEAD --oneline", response: "" },
      ]);
      // Should output "No changes since 1.0.0" - no error
    });

    test("should filter commits by ignore list", async () => {
      await setupCommand(
        [
          { cmd: "tag --sort=-version:refname", response: "1.0.0\n" },
          {
            cmd: "log 1.0.0..HEAD --oneline",
            response: [
              "abc12345 feat(ui): add dashboard",
              "def56789 feat(internal): should be filtered",
            ].join("\n"),
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
            cmd: "log 0.8.0..HEAD --oneline",
            response: "abc12345 feat(cli): new command",
          },
        ],
        ["changelog", "-f=0.8.0"],
      );
      // Outputs to stdout - test verifies no error
    });
  });
});
