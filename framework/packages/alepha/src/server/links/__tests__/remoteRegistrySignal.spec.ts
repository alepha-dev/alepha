import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { AbortedError, Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import {
  $remote,
  AlephaServerLinks,
  type FetchLinksOptions,
  RemotePrimitiveProvider,
} from "../index.ts";

/**
 * Counts the registry reads and how each one ended.
 */
class CountingRemoteProvider extends RemotePrimitiveProvider {
  public attempts = 0;
  public failures: string[] = [];
  public failWith: Error | undefined;

  public testFetchLinks = this.fetchLinks.bind(this);

  protected override async fetchLinksOnce(opts: FetchLinksOptions) {
    this.attempts++;
    try {
      if (this.failWith) {
        throw this.failWith;
      }
      return await super.fetchLinksOnce(opts);
    } catch (error) {
      this.failures.push(String((error as Error).cause ?? error));
      throw error;
    }
  }
}

const servers: Server[] = [];

/**
 * A remote whose registry takes `delay` ms to answer.
 */
const slowRemote = async (delay: number) => {
  const remote = { hits: 0, url: "" };
  const server = createServer((_request, response) => {
    remote.hits++;
    setTimeout(() => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ prefix: "/api", actions: {} }));
    }, delay);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  remote.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return remote;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("$remote registry read", () => {
  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it("is not aborted, nor retried, when the caller who triggered it leaves", async ({
    expect,
  }) => {
    const remote = await slowRemote(300);
    class Front {
      // `noInternal`: nothing is read at start, the first read is the
      // caller's.
      svc = $remote({ url: remote.url, proxy: { noInternal: true } });
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: RemotePrimitiveProvider, use: CountingRemoteProvider })
      .with(AlephaServerLinks)
      .with(Front);
    await alepha.start();
    const provider = alepha.inject(CountingRemoteProvider);
    const front = alepha.inject(ServerProvider).hostname;

    const controller = new AbortController();
    const left = fetch(`${front}/api/_links`, {
      signal: controller.signal,
    }).catch((error: Error) => error.name);
    await sleep(100);
    controller.abort();
    expect(await left).toBe("AbortError");
    // Past the first retry delay (one second) of a read that had failed.
    await sleep(1300);

    expect(provider.failures).toEqual([]);
    expect(provider.attempts).toBe(1);
    expect(remote.hits).toBe(1);
  });

  it("does not retry an abort", async ({ expect }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: RemotePrimitiveProvider,
      use: CountingRemoteProvider,
    });
    const provider = alepha.inject(CountingRemoteProvider);
    provider.failWith = new AbortedError("App stopping");

    await expect(
      provider.testFetchLinks({ url: "http://remote.example.app/api/_links" }),
    ).rejects.toThrow("App stopping");
    expect(provider.attempts).toBe(1);
  });
});
