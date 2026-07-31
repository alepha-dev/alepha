import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { BayAdapter } from "../adapters/BayAdapter.ts";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";
import {
  type BayCredential,
  BayCredentialProvider,
} from "../providers/BayCredentialProvider.ts";

/**
 * A credential store that never touches the user's real `~/.config`.
 *
 * Substituted rather than mocked: the point of these tests is what the adapter
 * decides, and a store it can actually read back from is what makes "the
 * renewed credential was persisted" observable.
 */
class MemoryBayCredentialProvider extends BayCredentialProvider {
  public store: Record<string, BayCredential> = {};

  // Only the file is replaced. Overriding `get` instead would take the
  // `$BAY_API_KEY` precedence out of the code under test — which is the one
  // rule CI depends on.
  protected override async read(): Promise<Record<string, BayCredential>> {
    return this.store;
  }

  protected override async write(
    store: Record<string, BayCredential>,
  ): Promise<void> {
    this.store = store;
  }
}

/**
 * Exposes the protected token path, and records what was asked of the network.
 */
class TestBayAdapter extends BayAdapter {
  public responses: Array<{ ok: boolean; status: number; body: unknown }> = [];
  public requests: Array<Record<string, unknown>> = [];
  /** Every wait the poll loop asked for, in order. */
  public waits: number[] = [];

  public testCli(ctx: PlatformContext, args: string): Promise<string> {
    return this.cli(ctx, args);
  }

  public testApiKey(ctx: PlatformContext): Promise<string> {
    return this.apiKey(ctx);
  }

  public testPoll(
    endpoint: string,
    opts: { intervalMs: number; deadline: number },
  ): Promise<BayCredential> {
    return this.pollForToken(endpoint, "device-code", opts);
  }

  protected override async sleep(ms: number): Promise<void> {
    this.waits.push(ms);
  }

  protected override async post(
    _url: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    this.requests.push(body);
    const next = this.responses.shift();
    if (!next) {
      throw new Error("no response queued");
    }
    return next;
  }
}

const context = (): PlatformContext =>
  ({
    env: "production",
    envConfig: { adapter: "bay", endpoint: "https://bay.example.com" },
  }) as unknown as PlatformContext;

const setup = () => {
  const alepha = Alepha.create().with({
    provide: BayCredentialProvider,
    use: MemoryBayCredentialProvider,
  });
  return {
    adapter: alepha.inject(TestBayAdapter),
    credentials: alepha.inject(
      BayCredentialProvider,
    ) as MemoryBayCredentialProvider,
    dateTime: alepha.inject(DateTimeProvider),
  };
};

describe("BayAdapter credentials", () => {
  it("refuses to guess when there is no credential", async () => {
    const { adapter } = setup();

    await expect(adapter.testApiKey(context())).rejects.toThrowError(
      /Not logged in to https:\/\/bay\.example\.com/,
    );
  });

  it("uses a token that is still comfortably valid without calling out", async () => {
    const { adapter, credentials, dateTime } = setup();
    credentials.store["https://bay.example.com"] = {
      accessToken: "still-good",
      refreshToken: "r1",
      expiresAt: dateTime.nowMillis() + 10 * 60_000,
    };

    expect(await adapter.testApiKey(context())).toBe("still-good");
    expect(adapter.requests).toHaveLength(0);
  });

  it("renews a token that expires within the skew, and keeps the new one", async () => {
    const { adapter, credentials, dateTime } = setup();
    credentials.store["https://bay.example.com"] = {
      accessToken: "about-to-die",
      refreshToken: "r1",
      // Inside the one-minute skew: still technically valid, but it would
      // expire mid-deploy.
      expiresAt: dateTime.nowMillis() + 5_000,
    };
    adapter.responses.push({
      ok: true,
      status: 200,
      body: { access_token: "fresh", refresh_token: "r2", expires_in: 900 },
    });

    expect(await adapter.testApiKey(context())).toBe("fresh");
    expect(adapter.requests[0]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "r1",
    });
    // Persisted, or the next command pays for another round trip.
    expect(credentials.store["https://bay.example.com"]).toMatchObject({
      accessToken: "fresh",
      refreshToken: "r2",
    });
  });

  it("keeps the old refresh token when the server does not rotate", async () => {
    const { adapter, credentials, dateTime } = setup();
    credentials.store["https://bay.example.com"] = {
      accessToken: "about-to-die",
      refreshToken: "r1",
      expiresAt: dateTime.nowMillis() + 5_000,
    };
    // No refresh_token in the response — dropping it would turn a thirty-day
    // login into a fifteen-minute one.
    adapter.responses.push({
      ok: true,
      status: 200,
      body: { access_token: "fresh", expires_in: 900 },
    });

    await adapter.testApiKey(context());

    expect(credentials.store["https://bay.example.com"].refreshToken).toBe(
      "r1",
    );
  });

  it("tells the user to log in again when the refresh is refused", async () => {
    const { adapter, credentials, dateTime } = setup();
    credentials.store["https://bay.example.com"] = {
      accessToken: "dead",
      refreshToken: "expired",
      expiresAt: dateTime.nowMillis() - 1,
    };
    adapter.responses.push({
      ok: false,
      status: 400,
      body: { error: "invalid_grant" },
    });

    await expect(adapter.testApiKey(context())).rejects.toThrowError(
      /alepha platform auth login --env production/,
    );
  });

  it("says so rather than sending a dead token it cannot renew", async () => {
    const { adapter, credentials, dateTime } = setup();
    // No refresh token: a credential written before refresh was kept.
    credentials.store["https://bay.example.com"] = {
      accessToken: "dead",
      expiresAt: dateTime.nowMillis() - 1,
    };

    await expect(adapter.testApiKey(context())).rejects.toThrowError(
      AlephaError,
    );
    expect(adapter.requests).toHaveLength(0);
  });

  it("takes $BAY_API_KEY over the file, and never tries to renew it", async () => {
    const { adapter, credentials } = setup();
    // CI supplies a key and has no file at all. It must also win over a stale
    // login sitting in the developer's home directory, or a laptop-shaped
    // credential would quietly override what the pipeline was configured with.
    credentials.store["https://bay.example.com"] = {
      accessToken: "from-file",
      refreshToken: "r1",
      expiresAt: 1,
    };
    process.env.BAY_API_KEY = "ak_from_ci";
    try {
      expect(await adapter.testApiKey(context())).toBe("ak_from_ci");
      expect(adapter.requests).toHaveLength(0);
    } finally {
      delete process.env.BAY_API_KEY;
    }
  });

  it("never expires a credential that carries no expiry", async () => {
    const { adapter, credentials } = setup();
    // What `$BAY_API_KEY` and a pre-refresh file both look like. An API key is
    // revoked, never renewed, so treating it as expired would break CI.
    credentials.store["https://bay.example.com"] = { accessToken: "ak_static" };

    expect(await adapter.testApiKey(context())).toBe("ak_static");
    expect(adapter.requests).toHaveLength(0);
  });
});

describe("BayAdapter device polling", () => {
  const options = (dateTime: { nowMillis: () => number }) => ({
    intervalMs: 5_000,
    deadline: dateTime.nowMillis() + 600_000,
  });

  it("keeps waiting at the same pace while nobody has answered", async () => {
    const { adapter, dateTime } = setup();
    adapter.responses.push(
      { ok: false, status: 400, body: { error: "authorization_pending" } },
      { ok: true, status: 200, body: { access_token: "t", expires_in: 900 } },
    );

    await adapter.testPoll("https://bay.example.com", options(dateTime));

    expect(adapter.waits).toEqual([5_000, 5_000]);
  });

  it("backs off when the server says slow_down, and stays slower afterwards", async () => {
    const { adapter, dateTime } = setup();
    adapter.responses.push(
      { ok: false, status: 400, body: { error: "slow_down" } },
      { ok: false, status: 400, body: { error: "authorization_pending" } },
      { ok: true, status: 200, body: { access_token: "t", expires_in: 900 } },
    );

    await adapter.testPoll("https://bay.example.com", options(dateTime));

    // Obeying once is not enough: the server asked for a slower pace, not for
    // one slower poll. Going back to 5s would earn another slow_down.
    expect(adapter.waits).toEqual([5_000, 10_000, 10_000]);
  });

  it("stops on a refusal instead of spinning until the code dies", async () => {
    const { adapter, dateTime } = setup();
    adapter.responses.push({
      ok: false,
      status: 400,
      body: { error: "access_denied" },
    });

    await expect(
      adapter.testPoll("https://bay.example.com", options(dateTime)),
    ).rejects.toThrowError(/refused/i);
  });

  it("gives up once the code can no longer be approved", async () => {
    const { adapter, dateTime } = setup();
    // A deadline already behind us: the loop must not poll at all.
    await expect(
      adapter.testPoll("https://bay.example.com", {
        intervalMs: 5_000,
        deadline: dateTime.nowMillis() - 1,
      }),
    ).rejects.toThrowError(/Gave up waiting/);
    expect(adapter.requests).toHaveLength(0);
  });
});

describe("BayAdapter — the package manager it shells out to", () => {
  /*
    `yarn` was hardcoded in `build` and `pack`.

    Deploying an npm workspace therefore failed at the build step with yarn's
    own error — for lindocara, a complaint about a missing lockfile entry,
    because the project has a `package-lock.json` and no `yarn.lock`. Nothing
    in the message mentioned Bay, the adapter, or that yarn was an assumption.
    The same bug had already been found and fixed in `dev.ts`; this copy was
    missed.
  */
  const withLockfile = async (lockfile: string) => {
    const alepha = Alepha.create()
      .with({
        provide: BayCredentialProvider,
        use: MemoryBayCredentialProvider,
      })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile(`/project/${lockfile}`, "");
    const adapter = alepha.inject(TestBayAdapter);
    return await adapter.testCli(
      { ...context(), root: "/project" } as PlatformContext,
      "build --target=bare",
    );
  };

  it("should use yarn for a yarn workspace", async () => {
    expect(await withLockfile("yarn.lock")).toBe(
      "yarn alepha build --target=bare",
    );
  });

  it("should run the binary, not a script, for an npm workspace", async () => {
    // Two ways to get this wrong, and the first fix hit the second: `npm
    // alepha …` is not a command, and `npm run alepha` looks for a
    // package.json SCRIPT by that name, which an app has no reason to declare.
    expect(await withLockfile("package-lock.json")).toBe(
      "npx alepha build --target=bare",
    );
  });

  it("should use pnpm exec for a pnpm workspace", async () => {
    expect(await withLockfile("pnpm-lock.yaml")).toBe(
      "pnpm exec alepha build --target=bare",
    );
  });

  it("should use bunx for a bun workspace", async () => {
    expect(await withLockfile("bun.lock")).toBe(
      "bunx alepha build --target=bare",
    );
  });
});
