import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  NodeFileSystemProvider,
  NodeShellProvider,
  ShellProvider,
} from "alepha/system";
import { afterEach, beforeEach, describe, it } from "vitest";

import { GitContextService } from "../services/GitContextService.ts";
import { GitQuestHistory } from "../services/GitQuestHistory.ts";
import { LoreArtifactPusher } from "../services/LoreArtifactPusher.ts";

/**
 * The quests a pushed commit's history references (#E154), read from a real
 * git repository in a temporary directory: a fake of git could not disagree
 * with the real one about a shallow clone or a rebase.
 */
describe("GitQuestHistory", () => {
  let alepha: Alepha;
  let dirs: string[];

  beforeEach(async () => {
    alepha = Alepha.create()
      // The real shell: a test container defaults to the memory one.
      .with({ provide: ShellProvider, use: NodeShellProvider })
      .with(GitQuestHistory);
    await alepha.start();
    dirs = [];
  });

  afterEach(async () => {
    await alepha.stop();
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const tempDir = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };

  const git = async (root: string, ...args: string[]) => {
    const result = await alepha
      .inject(ShellProvider)
      .capture(["git", ...args], { root });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    }
    return result.stdout.trim();
  };

  /**
   * A repository whose commits carry the given messages, oldest first, each
   * changing `file.txt`. Answers each commit's sha.
   */
  const repository = async (messages: string[]) => {
    const root = tempDir("lore-quests-");
    await git(root, "init", "-q", "-b", "main");
    await git(root, "config", "user.email", "ci@example.app");
    await git(root, "config", "user.name", "CI");
    await git(root, "config", "commit.gpgsign", "false");
    const shas: string[] = [];
    for (const [i, message] of messages.entries()) {
      writeFileSync(join(root, "file.txt"), `${i}\n`);
      await git(root, "add", "file.txt");
      await git(root, "commit", "-q", "-m", message);
      shas.push(await git(root, "rev-parse", "HEAD"));
    }
    return { root, shas };
  };

  const walk = (
    root: string,
    known: Array<{ sha: string; complete: boolean }> | undefined = [],
    bare = false,
    paths?: string[],
  ) => {
    const asked: string[][] = [];
    return {
      asked,
      result: alepha.inject(GitQuestHistory).walk({
        root,
        bare,
        ...(paths ? { paths } : {}),
        known: async (shas) => {
          asked.push(shas);
          return known;
        },
      }),
    };
  };

  it("walks the whole history on a first push, reading refs in subjects and bodies", async ({
    expect,
  }) => {
    const { root, shas } = await repository([
      "feat: one #Q1",
      "fix: two\n\nThe body names #Q12 and #Q7.",
      "chore: nothing here (#40)",
    ]);

    const { result, asked } = walk(root);
    const found = await result;

    expect(found).toEqual({
      numbers: [1, 7, 12],
      walked: shas.toReversed(),
      complete: true,
    });
    expect(asked[0]).toEqual(shas.toReversed());
  });

  it("walks only from the newest complete base Lore knows", async ({
    expect,
  }) => {
    const { root, shas } = await repository([
      "a #Q1",
      "b #Q2",
      "c #Q3",
      "d #Q4",
    ]);

    const found = await walk(root, [
      { sha: shas[2] as string, complete: false },
      { sha: shas[1] as string, complete: true },
    ]).result;

    expect(found.base).toBe(shas[1]);
    expect(found.numbers).toEqual([3, 4]);
    expect(found.walked).toEqual([shas[3], shas[2]]);
    expect(found.complete).toBe(true);
  });

  describe("an app's paths (#Q3868)", () => {
    /**
     * A repository holding two apps: each commit changes one file, named
     * with its message. Answers each commit's sha.
     */
    const monorepo = async (
      commits: Array<[path: string, message: string]>,
    ) => {
      const root = tempDir("lore-quests-");
      await git(root, "init", "-q", "-b", "main");
      await git(root, "config", "user.email", "ci@example.app");
      await git(root, "config", "user.name", "CI");
      await git(root, "config", "commit.gpgsign", "false");
      const shas: string[] = [];
      for (const [i, [path, message]] of commits.entries()) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), `${i}\n`);
        await git(root, "add", path);
        await git(root, "commit", "-q", "-m", message);
        shas.push(await git(root, "rev-parse", "HEAD"));
      }
      return { root, shas };
    };

    it("reads only the commits that touched them, from the repository root", async ({
      expect,
    }) => {
      const { root, shas } = await monorepo([
        ["apps/web/a.txt", "web #Q1"],
        ["apps/docs/a.txt", "docs #Q2"],
        ["packages/kit/a.txt", "kit #Q3"],
        ["apps/web/b.txt", "web again #Q4"],
        ["README.md", "readme #Q5"],
      ]);

      // Walked from inside the app's own folder, as a push runs: the paths
      // are still read from the root.
      const { result, asked } = walk(join(root, "apps/docs"), [], false, [
        "apps/docs",
        "packages/kit",
      ]);
      const found = await result;

      expect(found).toEqual({
        numbers: [2, 3],
        walked: [shas[2], shas[1]],
        complete: true,
      });
      // Every commit is still offered as a base: the newest one Lore knows
      // need not have touched the paths.
      expect(asked[0]).toEqual(shas.toReversed());
    });

    it("walks from the base Lore knows for the app, whatever that commit touched", async ({
      expect,
    }) => {
      const { root, shas } = await monorepo([
        ["apps/docs/a.txt", "docs #Q1"],
        ["apps/web/a.txt", "web #Q2"],
        ["apps/docs/b.txt", "docs #Q3"],
        ["apps/web/b.txt", "web #Q4"],
      ]);

      const found = await walk(
        root,
        [{ sha: shas[1] as string, complete: true }],
        false,
        ["apps/docs"],
      ).result;

      expect(found).toEqual({
        base: shas[1],
        numbers: [3],
        walked: [shas[2]],
        complete: true,
      });
    });

    it("finds nothing, completely, when no commit touched them", async ({
      expect,
    }) => {
      const { root } = await monorepo([["apps/web/a.txt", "web #Q1"]]);

      expect(await walk(root, [], false, ["apps/docs"]).result).toEqual({
        numbers: [],
        walked: [],
        complete: true,
      });
    });
  });

  it("finds no base after a rebase rewrote the shas Lore knew, and keeps the refs", async ({
    expect,
  }) => {
    // Lore knows the pre-rebase commit; it is no longer in HEAD's history,
    // so the walk starts over and the message refs survive the rewrite.
    const { root, shas } = await repository(["a #Q1", "b #Q2"]);
    const before = shas[1] as string;
    await git(root, "commit", "-q", "--amend", "-m", "b, reworded #Q2");

    const found = await walk(root, [{ sha: before, complete: true }]).result;

    expect(found.base).toBeUndefined();
    expect(found.numbers).toEqual([1, 2]);
    expect(found.walked).not.toContain(before);
    expect(found.complete).toBe(true);
  });

  it("counts a bare #<n> only when the project opts in, and never an HTML entity", async ({
    expect,
  }) => {
    const { root } = await repository(["feat: thing (#40) &#38; #Q3"]);

    expect((await walk(root, [], false).result).numbers).toEqual([3]);
    expect((await walk(root, [], true).result).numbers).toEqual([3, 40]);
  });

  it("walks an older Lore's history whole when the known-commits read fails", async ({
    expect,
  }) => {
    const { root } = await repository(["a #Q1"]);

    const found = await alepha.inject(GitQuestHistory).walk({
      root,
      bare: false,
      known: async () => {
        throw new Error("404");
      },
    });

    expect(found).toMatchObject({ numbers: [1], complete: true });
  });

  describe("a shallow clone", () => {
    const shallow = async (depth = 1) => {
      const origin = await repository(["a #Q1", "b #Q2", "c #Q3"]);
      const clone = tempDir("lore-shallow-");
      await git(
        clone,
        "clone",
        "-q",
        "--depth",
        String(depth),
        `file://${origin.root}`,
        ".",
      );
      return { root: clone, shas: origin.shas };
    };

    it("is partial with no base, and still sends the refs it found", async ({
      expect,
    }) => {
      const { root } = await shallow();

      const found = await walk(root).result;

      expect(found).toMatchObject({
        numbers: [3],
        complete: false,
        reason: "shallow",
      });
    });

    it("is complete when Lore knows an ancestor the clone holds", async ({
      expect,
    }) => {
      // A depth-2 clone holds HEAD and its parent; Lore recorded the parent
      // on the previous push, so the range is all the walk needs.
      const { root, shas } = await shallow(2);

      const found = await walk(root, [
        { sha: shas[1] as string, complete: true },
      ]).result;

      expect(found).toEqual({
        base: shas[1],
        numbers: [3],
        walked: [shas[2]],
        complete: true,
      });
    });
  });

  describe("a history past the cap (#Q3815)", () => {
    /** The real walk, with a cap a test repository can pass. */
    class ShortWalk extends GitQuestHistory {
      protected override get maxWalked(): number {
        return 2;
      }
    }

    it("is partial, too-long, and sends no more shas than the cap", async ({
      expect,
    }) => {
      const { root, shas } = await repository(["a #Q1", "b #Q2", "c #Q3"]);
      const short = Alepha.create()
        .with({ provide: ShellProvider, use: NodeShellProvider })
        .with({ provide: GitQuestHistory, use: ShortWalk });
      await short.start();
      try {
        const found = await short.inject(GitQuestHistory).walk({
          root,
          bare: false,
          known: async () => [],
        });

        expect(found.complete).toBe(false);
        expect(found.reason).toBe("too-long");
        // The newest ones, at most the cap.
        expect(found.walked).toEqual([shas[2], shas[1]]);
        // Every ref found still goes: a partial walk loses no quest.
        expect(found.numbers).toEqual([1, 2, 3]);
      } finally {
        await short.stop();
      }
    });

    it("fits the commits part Lore reads", ({ expect }) => {
      // `ArtifactController.pushArtifact` reads `commits` with
      // `z.file({ maxBytes: 4 * 1024 * 1024 })`; a sha is `"<40 hex>",`.
      const shas = Array.from({ length: GitQuestHistory.MAX_WALKED }, () =>
        "f".repeat(40),
      );
      expect(Buffer.byteLength(JSON.stringify(shas))).toBeLessThanOrEqual(
        4 * 1024 * 1024,
      );
    });
  });

  it("is partial with no repository at all", async ({ expect }) => {
    const found = await walk(tempDir("lore-norepo-")).result;

    expect(found).toEqual({
      numbers: [],
      walked: [],
      complete: false,
      reason: "no-repository",
    });
  });
});

describe("GitContextService.dirty", () => {
  let alepha: Alepha;
  let dir: string;

  beforeEach(async () => {
    alepha = Alepha.create()
      .with({ provide: ShellProvider, use: NodeShellProvider })
      .with(GitContextService);
    await alepha.start();
    dir = mkdtempSync(join(tmpdir(), "lore-dirty-"));
  });

  afterEach(async () => {
    await alepha.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const git = (...args: string[]) =>
    alepha.inject(ShellProvider).capture(["git", ...args], { root: dir });

  const committed = async () => {
    await git("init", "-q");
    await git("config", "user.email", "ci@example.app");
    await git("config", "user.name", "CI");
    await git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "package.json"), "{}\n");
    await git("add", "package.json");
    await git("commit", "-q", "-m", "init");
  };

  it("is clean with untracked files only", async ({ expect }) => {
    await committed();
    writeFileSync(join(dir, "build-output.js"), "x");

    expect(await alepha.inject(GitContextService).dirty(dir)).toEqual({
      dirty: false,
      paths: [],
    });
  });

  it("is dirty with a tracked change, and names the path", async ({
    expect,
  }) => {
    await committed();
    writeFileSync(join(dir, "package.json"), '{ "version": "1.0.0" }\n');

    expect(await alepha.inject(GitContextService).dirty(dir)).toEqual({
      dirty: true,
      paths: ["package.json"],
    });
  });

  it("cannot say outside a repository", async ({ expect }) => {
    expect(await alepha.inject(GitContextService).dirty(dir)).toBeUndefined();
  });
});

describe("LoreArtifactPusher's quest line", () => {
  const pusher = () => Alepha.create().inject(LoreArtifactPusher);

  it("says the count, complete or partial, the base and clean or dirty", ({
    expect,
  }) => {
    expect(
      pusher().questLine(
        { base: "a".repeat(40), numbers: [1], walked: [], complete: true },
        { dirty: false },
        42,
      ),
    ).toBe("42 quests referenced (complete, since aaaaaaaaaaaa), clean");
    expect(
      pusher().questLine(
        { numbers: [1], walked: [], complete: false, reason: "shallow" },
        { dirty: true },
        undefined,
      ),
    ).toBe("1 quest referenced (partial, full history), dirty");
  });

  it("names fetch-depth: 0 for a shallow clone", ({ expect }) => {
    expect(pusher().partialReason("shallow")).toMatch(
      /`fetch-depth: 0` on `actions\/checkout`/,
    );
  });
});

/**
 * The two walks of one push (#Q3868): the whole history as always, and the
 * commits that touched the paths `.alepha/lore.json` declares for the app.
 * On a real repository and a real link file; only Lore's answer is stated.
 */
describe("LoreArtifactPusher's walks", () => {
  type Ask = { shas: string[]; app?: string; paths?: string };

  class TestLore extends LinkProvider {
    public asked: Ask[] = [];
    /**
     * A Lore from before the app's sets: it ignores `app` and echoes none.
     */
    public old = false;
    public known: Array<{ sha: string; complete: boolean }> = [];

    override client(): any {
      return {
        findKnownCommits: async (config: { body: Ask }) => {
          this.asked.push(config.body);
          return config.body.app && !this.old
            ? { known: [], app: config.body.app }
            : { known: this.known };
        },
      };
    }
  }

  class TestPusher extends LoreArtifactPusher {
    public walksOf(root: string, app: string) {
      return this.walk(root, 7, app);
    }
  }

  let alepha: Alepha;
  let root: string;
  let shas: string[];

  const git = async (...args: string[]) => {
    const result = await alepha
      .inject(ShellProvider)
      .capture(["git", ...args], { root });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    }
    return result.stdout.trim();
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LORE_API_KEY: "k", LORE_URL: "", LORE_PROJECT: "" },
    })
      .with({ provide: ShellProvider, use: NodeShellProvider })
      .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
      .with({ provide: LinkProvider, use: TestLore })
      .with(TestPusher);
    await alepha.start();
    root = mkdtempSync(join(tmpdir(), "lore-walks-"));
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "ci@example.app");
    await git("config", "user.name", "CI");
    await git("config", "commit.gpgsign", "false");
    shas = [];
    for (const [i, [path, message]] of [
      ["apps/web/a.txt", "web #Q1"],
      ["apps/docs/a.txt", "docs #Q2"],
      ["apps/web/b.txt", "web again #Q3"],
    ].entries()) {
      mkdirSync(join(root, path as string, ".."), { recursive: true });
      writeFileSync(join(root, path as string), `${i}\n`);
      await git("add", path as string);
      await git("commit", "-q", "-m", message as string);
      shas.push(await git("rev-parse", "HEAD"));
    }
    mkdirSync(join(root, ".alepha"));
    writeFileSync(
      join(root, ".alepha/lore.json"),
      JSON.stringify({ project: "acme", apps: { docs: ["apps/docs"] } }),
    );
  });

  afterEach(async () => {
    await alepha.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("walks the whole history, and the app's paths when the link file declares them", async ({
    expect,
  }) => {
    const walks = await alepha
      .inject(TestPusher)
      .walksOf(join(root, "apps/docs"), "docs");

    expect(walks.whole.numbers).toEqual([1, 2, 3]);
    expect(walks.scoped).toEqual({
      paths: "apps/docs",
      walk: { numbers: [2], walked: [shas[1]], complete: true },
    });
    // Lore is asked twice: for the whole history, then for the app with
    // the very paths the walk reads.
    expect(alepha.inject(TestLore).asked).toEqual([
      { shas: shas.toReversed() },
      { shas: shas.toReversed(), app: "docs", paths: "apps/docs" },
    ]);
  });

  it("walks the whole history only for an app that declares nothing", async ({
    expect,
  }) => {
    const walks = await alepha
      .inject(TestPusher)
      .walksOf(join(root, "apps/web"), "web");

    expect(walks.whole.numbers).toEqual([1, 2, 3]);
    expect(walks.scoped).toBeUndefined();
    expect(alepha.inject(TestLore).asked).toHaveLength(1);
  });

  it("takes no base from a Lore that answers the whole-history sets for the app", async ({
    expect,
  }) => {
    // Such a Lore knows HEAD: as a base it would leave the app's walk
    // empty, and every quest of the app unrecorded.
    const lore = alepha.inject(TestLore);
    lore.old = true;
    lore.known = [{ sha: shas[2] as string, complete: true }];

    const walks = await alepha.inject(TestPusher).walksOf(root, "docs");

    expect(walks.whole).toMatchObject({ base: shas[2], numbers: [] });
    expect(walks.scoped?.walk).toEqual({
      numbers: [2],
      walked: [shas[1]],
      complete: true,
    });
  });

  it("says the app's count on its own line", ({ expect }) => {
    const pusher = alepha.inject(TestPusher);
    const walk = { numbers: [2], walked: [], complete: true };

    expect(pusher.appQuestLine("docs", walk, 4)).toBe(
      "4 of them touch the paths of docs (complete, full history)",
    );
    expect(
      pusher.appQuestLine("docs", { ...walk, base: "a".repeat(40) }, 1),
    ).toBe(
      "1 of them touches the paths of docs (complete, since aaaaaaaaaaaa)",
    );
  });
});
