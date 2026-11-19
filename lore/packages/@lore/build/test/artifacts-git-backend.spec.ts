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
  /**
   * The first-parent chain `log` walks, newest first.
   */
  public history: Array<{ hash: string; message: string }> = [];

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
      log: async (options) => {
        this.calls.push(`log ${options.offset ?? 0}`);
        const offset = options.offset ?? 0;
        return this.history.slice(offset, offset + (options.limit ?? 50));
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
  it("lists a push's commits by log, page by page, back to the old id (#Q3945)", async ({
    expect,
  }) => {
    const { backend, binding } = setup();
    await backend.create("7-a", { defaultBranch: "main" });
    binding.history = Array.from({ length: 5 }, (_, i) => ({
      hash: String(i).repeat(40),
      message: `commit ${i}`,
    }));

    const listed = await backend.commits("7-a", {
      from: "3".repeat(40),
      to: "0".repeat(40),
      limit: 10,
    });
    const tooMany = await backend.commits("7-a", {
      from: "3".repeat(40),
      to: "0".repeat(40),
      limit: 2,
    });
    const notOnChain = await backend.commits("7-a", {
      from: "f".repeat(40),
      to: "0".repeat(40),
      limit: 10,
    });

    expect(listed.map((it) => it.message)).toEqual([
      "commit 0",
      "commit 1",
      "commit 2",
    ]);
    expect(tooMany).toEqual([]);
    expect(notOnChain).toEqual([]);
  });

  it("keeps the packfile alone behind the header: NAK before, Artifacts' flush after (#Q3946)", async ({
    expect,
  }) => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const pack = new Uint8Array([...encode("PACK"), 0, 0, 0, 2, 9, 9, 9]);
    const chunks = [
      encode("0008NA"),
      encode("K\n"),
      pack.slice(0, 5),
      pack.slice(5),
      encode("0000"),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });

    const out = new Uint8Array(
      await new Response(
        ArtifactsGitBackend.packAfterNak(encode("HEADER\n"), body),
      ).arrayBuffer(),
    );

    expect([...out]).toEqual([...encode("HEADER\n"), ...pack]);
  });

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

  it("proxies to the remote with the cached token, streaming the body", async ({
    expect,
  }) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    class ProxyingBackend extends ArtifactsGitBackend {
      protected override async fetchUpstream(url: string, init: RequestInit) {
        calls.push({ url, init });
        return new Response("0000", {
          status: 200,
          headers: { "content-type": "application/x-git-receive-pack-result" },
        });
      }
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const binding = new RecordingBinding();
    alepha.set("cloudflare.env" as never, { ARTIFACTS: binding } as never);
    const backend = alepha.inject(ProxyingBackend);
    await backend.create("7-r", { defaultBranch: "main" });
    const body = new Blob(["0000"]).stream();

    const response = await backend.serve("7-r", {
      service: "git-receive-pack",
      advertise: false,
      body,
      gitProtocol: "version=2",
    });
    await backend.serve("7-r", { service: "git-upload-pack", advertise: true });

    expect(response.status).toBe(200);
    expect(calls[0]!.url).toMatch(/\/7-r\.git\/git-receive-pack$/);
    expect(calls[0]!.init.body).toBe(body);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(atob(headers.authorization!.slice("Basic ".length))).toMatch(
      /^x:art_write_/,
    );
    expect(headers["git-protocol"]).toBe("version=2");
    expect(calls[1]!.url).toMatch(
      /\/7-r\.git\/info\/refs\?service=git-upload-pack$/,
    );
    expect(calls[1]!.init.method).toBe("GET");
  });

  it("names the missing binding rather than failing on undefined", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const backend = alepha.inject(ArtifactsGitBackend);
    await expect(backend.list()).rejects.toThrow(/ARTIFACTS is missing/);
  });
});
