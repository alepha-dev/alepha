import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { LoreService } from "./LoreService.ts";

/**
 * Answers Lore's two endpoints from memory, in the shapes lore.alepha.dev
 * actually returns (status under `metadata`), and records what was asked and
 * with which key.
 */
class TestLoreService extends LoreService {
  public requests: string[] = [];

  protected override async request<T>(
    path: string,
    key: string,
  ): Promise<T | undefined> {
    this.requests.push(`${key} ${path}`);
    if (path === "/api/getEpicRefs/1") {
      return [{ id: 103, number: 53, title: "Loom", status: "active" }] as T;
    }
    const shortId = Number(/quests\/(\d+)$/.exec(path)?.[1]);
    if (shortId === 2224) {
      return {
        id: 2541,
        shortId,
        title: "Loom v1",
        area: "loom",
        epicId: 103,
        metadata: { status: "accepted", totalTimeSpent: 0 },
      } as T;
    }
    return undefined;
  }
}

const project = {
  id: "alepha",
  name: "alepha",
  path: "/repo",
  loreProjectId: 1,
  loreProjectSlug: "alepha",
};

/**
 * An in-memory home, and `LORE_API_KEY` explicitly empty unless given: the
 * machine running the spec may have both a real `~/.lore-api-key` and the
 * variable exported, and neither may decide the result.
 */
const setup = (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({
    env: { HOME: "/home/me", LORE_API_KEY: "", ...env },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: LoreService, use: TestLoreService });
  return {
    lore: alepha.inject(TestLoreService),
    fs: alepha.inject(MemoryFileSystemProvider),
  };
};

describe("LoreService", () => {
  it("finds every #Q number once, newest first", ({ expect }) => {
    const { lore } = setup();

    expect(
      lore.questIds(
        [
          "Merge remote-tracking branch 'origin/main' (#Q2220)",
          "fix(loom): the path (#Q2220)",
          "feat(loom): deploy (#Q2218)",
          "not a quest: #Q, Q12, #12",
        ].join("\n"),
      ),
    ).toEqual([2220, 2218]);
  });

  it("links quests without asking Lore when there is no key", async ({
    expect,
  }) => {
    const { lore } = setup();

    const refs = await lore.resolve(project, [2224]);

    expect(refs.get(2224)).toEqual({
      shortId: 2224,
      url: "https://lore.alepha.dev/alepha/quests/2224",
    });
    expect(lore.requests).toEqual([]);
    expect(await lore.enabled()).toBe(false);
  });

  it("adds title, status and epic with a key", async ({ expect }) => {
    const { lore } = setup({ LORE_API_KEY: "ak_env" });

    const refs = await lore.resolve(project, [2224, 9999]);

    expect(refs.get(2224)).toEqual({
      shortId: 2224,
      title: "Loom v1",
      status: "accepted",
      url: "https://lore.alepha.dev/alepha/quests/2224",
      epic: { number: 53, title: "Loom", status: "active" },
    });
    // A quest Lore does not know stays a bare number and link.
    expect(refs.get(9999)).toEqual({
      shortId: 9999,
      url: "https://lore.alepha.dev/alepha/quests/9999",
    });
  });

  it("reads the key from ~/.lore-api-key when LORE_API_KEY is unset", async ({
    expect,
  }) => {
    const { lore, fs } = setup();
    await fs.writeFile("/home/me/.lore-api-key", "ak_file\n");

    await lore.resolve(project, [2224]);

    expect(await lore.enabled()).toBe(true);
    expect(lore.requests).toContain("ak_file /api/projects/1/quests/2224");
  });

  it("prefers LORE_API_KEY over the file", async ({ expect }) => {
    const { lore, fs } = setup({ LORE_API_KEY: "ak_env" });
    await fs.writeFile("/home/me/.lore-api-key", "ak_file\n");

    expect(await lore.apiKey()).toBe("ak_env");
  });

  it("picks up a rotated key without a restart", async ({ expect }) => {
    const { lore, fs } = setup();
    await fs.writeFile("/home/me/.lore-api-key", "ak_old\n");
    fs.mtimes.set("/home/me/.lore-api-key", 1_000);
    expect(await lore.apiKey()).toBe("ak_old");

    await fs.writeFile("/home/me/.lore-api-key", "ak_new\n");
    fs.mtimes.set("/home/me/.lore-api-key", 2_000);
    expect(await lore.apiKey()).toBe("ak_new");

    await fs.rm("/home/me/.lore-api-key");
    expect(await lore.apiKey()).toBe("");
  });
});
