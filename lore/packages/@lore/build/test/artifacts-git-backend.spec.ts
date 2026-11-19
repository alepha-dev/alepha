import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  type ArtifactsBinding,
  ArtifactsGitBackend,
  type ArtifactsRepoHandle,
} from "../src/api/index.ts";

/**
 * What `ArtifactsGitBackend` adds over the binding (#Q3928): names by id,
 * one minted token per repository and scope while it lasts, and a delete of
 * a repository already gone that does not throw.
 *
 * The binding here only records calls and answers like the real one's
 * types; what Artifacts itself does is proven against the real namespace
 * (`test/artifacts-contract.ts`, by hand) and on production.
 */
class RecordingBinding implements ArtifactsBinding {
  public readonly calls: string[] = [];
  public readonly repos = new Set<string>();

  async create(name: string) {
    this.calls.push(`create ${name}`);
    this.repos.add(name);
    return { name, remote: this.remoteOf(name), token: "initial" };
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    this.calls.push(`get ${name}`);
    if (!this.repos.has(name)) {
      throw Object.assign(new Error("Repository not found"), {
        code: "NOT_FOUND",
      });
    }
    return {
      info: async () => {
        this.calls.push(`info ${name}`);
        return { defaultBranch: "main", remote: this.remoteOf(name) };
      },
      createToken: async (scope) => {
        this.calls.push(`token ${name} ${scope}`);
        return {
          plaintext: `art_${scope}_${this.calls.length}`,
          expiresAt: "2099-01-01T00:00:00Z",
        };
      },
    };
  }

  async list() {
    return { repos: [...this.repos].map((name) => ({ name })) };
  }

  async delete(name: string) {
    this.calls.push(`delete ${name}`);
    return this.repos.delete(name);
  }

  protected remoteOf(name: string) {
    return `https://acme.artifacts.cloudflare.net/git/lore-test/${name}.git`;
  }
}

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const binding = new RecordingBinding();
  alepha.set("cloudflare.env" as never, { ARTIFACTS: binding } as never);
  return { alepha, binding, backend: alepha.inject(ArtifactsGitBackend) };
};

describe("ArtifactsGitBackend", () => {
  it("names a repository by ids, never by slug", ({ expect }) => {
    const { backend } = setup();
    expect(backend.refFor({ projectId: 7, repoId: "a-b" })).toBe("7-a-b");
  });

  it("mints one token per repository and scope, then reuses it", async ({
    expect,
  }) => {
    const { backend, binding } = setup();
    await backend.create("7-r", { defaultBranch: "main" });

    const first = await backend.token("7-r", "read");
    const second = await backend.token("7-r", "read");
    const write = await backend.token("7-r", "write");

    expect(second).toEqual(first);
    expect(write?.token).not.toBe(first?.token);
    expect(first?.remote).toMatch(/\/7-r\.git$/);
    expect(binding.calls.filter((it) => it.startsWith("token"))).toEqual([
      "token 7-r read",
      "token 7-r write",
    ]);
  });

  it("mints again once the cached token is past its reuse window", async ({
    expect,
  }) => {
    const { alepha, backend, binding } = setup();
    await backend.create("7-r", { defaultBranch: "main" });
    await backend.token("7-r", "read");

    await alepha
      .inject(DateTimeProvider)
      .travel(ArtifactsGitBackend.TOKEN_REUSE_MS + 1);
    await backend.token("7-r", "read");

    expect(binding.calls.filter((it) => it.startsWith("token"))).toHaveLength(
      2,
    );
  });

  it("answers undefined for a repository it does not hold", async ({
    expect,
  }) => {
    const { backend } = setup();
    expect(await backend.token("7-missing", "read")).toBeUndefined();
    expect(await backend.info("7-missing")).toBeUndefined();
  });

  it("deletes a repository, twice without a throw, and forgets its tokens", async ({
    expect,
  }) => {
    const { backend, binding } = setup();
    await backend.create("7-r", { defaultBranch: "main" });
    await backend.token("7-r", "write");

    await backend.delete("7-r");
    await backend.delete("7-r");

    expect(await backend.list()).toEqual([]);
    expect(await backend.token("7-r", "write")).toBeUndefined();
    expect(binding.calls.filter((it) => it.startsWith("delete"))).toHaveLength(
      2,
    );
  });

  it("names the missing binding rather than failing on undefined", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const backend = alepha.inject(ArtifactsGitBackend);
    await expect(backend.list()).rejects.toThrow(/ARTIFACTS is missing/);
  });
});
