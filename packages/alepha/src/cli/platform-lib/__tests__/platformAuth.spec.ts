import { Alepha } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { describe, expect, it } from "vitest";
import { BayAdapter } from "../adapters/BayAdapter.ts";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import {
  PlatformAdapter,
  type PlatformContext,
} from "../adapters/PlatformAdapter.ts";
import { WranglerApi } from "../services/WranglerApi.ts";

/**
 * Records what wrangler was asked to do, and installs nothing.
 *
 * Substituted rather than mocked, and deliberately inert: the real `login`
 * opens a browser and the real `logout` signs the developer out of their actual
 * Cloudflare account — running either from a test suite would reach outside the
 * machine and break the person running it.
 */
class RecordingWranglerApi extends WranglerApi {
  public actions: string[] = [];

  public override async ensureInstalled(): Promise<void> {
    this.actions.push("ensureInstalled");
  }

  public override async login(): Promise<void> {
    this.actions.push("wrangler login");
  }
}

/**
 * An adapter that overrides nothing beyond the abstract surface.
 *
 * The point of the test below is the BASE CLASS default, not any particular
 * target — so it is pinned here rather than borrowed from whichever concrete
 * adapter happens to lack a login this month. (It used to borrow Vercel's,
 * which is why removing Vercel broke it.)
 */
class LoginlessAdapter extends PlatformAdapter {
  async authenticate(): Promise<void> {}
  async build(): Promise<void> {}
  async deploy(): Promise<any> {
    return {};
  }
  async inspect(): Promise<any> {
    return {};
  }
  async teardown(): Promise<void> {}
}

/**
 * Runs a task's handler straight through, so a test sees what the adapter did
 * rather than what the runner reported.
 */
const run: RunnerMethod = (async (task: { handler: () => Promise<unknown> }) =>
  await task.handler()) as unknown as RunnerMethod;

const context = (): PlatformContext =>
  ({ env: "production", root: "/app", envConfig: {} }) as PlatformContext;

describe("platform auth", () => {
  it("hands Cloudflare's login to wrangler", async () => {
    const alepha = Alepha.create().with({
      provide: WranglerApi,
      use: RecordingWranglerApi,
    });
    const adapter = alepha.inject(CloudflareAdapter);
    const wrangler = alepha.inject(WranglerApi) as RecordingWranglerApi;

    await adapter.login(context(), run);

    // Installed first: `wrangler login` on a machine with no wrangler fails
    // with a shell error rather than anything about logging in.
    expect(wrangler.actions).toEqual(["ensureInstalled", "wrangler login"]);
  });

  it("refuses on an adapter with no interactive login, and says what to do instead", async () => {
    const alepha = Alepha.create();
    const adapter = alepha.inject(LoginlessAdapter);

    // The base-class default. Doing nothing quietly would be worse: the user
    // would believe they are logged in.
    await expect(adapter.login(context(), run)).rejects.toThrowError(
      /has no interactive login/,
    );
    await expect(adapter.logout(context(), run)).rejects.toThrowError(
      /has no interactive logout/,
    );
  });

  it("makes Bay name the host it cannot find, rather than assuming one", async () => {
    const alepha = Alepha.create();
    const adapter = alepha.inject(BayAdapter);

    // Unlike Cloudflare there is no global destination to fall back on: a Bay
    // is a machine someone owns, reached over SSH.
    await expect(adapter.login(context(), run)).rejects.toThrowError(
      /No Bay host for environment "production"/,
    );
  });
});
