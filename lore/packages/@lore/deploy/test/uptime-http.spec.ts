import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  createServer as createSecureServer,
  type RequestOptions,
} from "node:https";
import type { AddressInfo } from "node:net";

import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

import { monitors } from "../src/api/entities/monitors.ts";
import { UptimeHttpProber } from "../src/api/services/UptimeHttpProber.ts";

const certificate = readFileSync(
  new URL("./fixtures/uptime/cert.pem", import.meta.url),
);
const key = readFileSync(new URL("./fixtures/uptime/key.pem", import.meta.url));

class TrustedProber extends UptimeHttpProber {
  protected override requestOptions(): RequestOptions {
    return { ca: certificate };
  }
}

const monitor = (target: string, expect = {}, timeoutSecs = 1) =>
  monitors.schema.parse({
    id: crypto.randomUUID(),
    version: 0,
    projectId: 1,
    createdAt: new Date().toISOString(),
    name: "Local",
    kind: "http",
    target,
    intervalSecs: 60,
    timeoutSecs,
    confirmations: 2,
    expect,
    active: true,
    status: "pending",
    statusSince: "2026-10-15T00:00:00Z",
    failures: 0,
    nextCheckAt: "2026-10-15T00:00:00Z",
  });

describe("HTTP uptime prober", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of cleanup.splice(0)) await stop();
  });

  const serve = async (secure = false) => {
    const handler: Parameters<typeof createServer>[1] = (request, response) => {
      if (request.url === "/timeout") return;
      if (request.url === "/status-stall" || request.url === "/body-stall") {
        response.writeHead(request.url === "/status-stall" ? 503 : 200);
        response.write("healthy");
        return;
      }
      const send = () => {
        response.statusCode = request.url === "/failure" ? 503 : 200;
        response.end(`${request.method} healthy`);
      };
      if (request.url === "/slow") setTimeout(send, 30);
      else send();
    };
    const server = secure
      ? createSecureServer({ key, cert: certificate }, handler)
      : createServer(handler);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    return `${secure ? "https" : "http"}://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  it("uses GET, checks status before keyword, and accepts a configured status", async ({
    expect,
  }) => {
    const url = await serve();
    const prober = Alepha.create().inject(UptimeHttpProber);
    expect(
      (await prober.probe(monitor(url, { keyword: "GET healthy" }))).ok,
    ).toBe(true);
    expect(
      (await prober.probe(monitor(`${url}/failure`, { keyword: "missing" })))
        .result,
    ).toBe("status");
    expect(
      (await prober.probe(monitor(`${url}/failure`, { status: 503 }))).ok,
    ).toBe(true);
    expect(
      (
        await prober.probe(
          monitor(`${url}/status-stall`, { keyword: "missing" }),
        )
      ).result,
    ).toBe("status");
    expect(
      (await prober.probe(monitor(url, { keyword: "missing" }))).result,
    ).toBe("keyword");
  });

  it("reports a total timeout and a refused connection as results", async ({
    expect,
  }) => {
    const url = await serve();
    const prober = Alepha.create().inject(UptimeHttpProber);
    expect((await prober.probe(monitor(`${url}/timeout`))).result).toBe(
      "timeout",
    );
    expect(
      (await prober.probe(monitor(`${url}/body-stall`, { keyword: "healthy" })))
        .result,
    ).toBe("timeout");
    const result = await prober.probe(monitor("http://127.0.0.1:1"));
    expect(result.ok).toBe(false);
    expect(result.result).toBe("connection");
  });

  it("keeps a slow successful response up while identifying the latency breach", async ({
    expect,
  }) => {
    const url = await serve();
    const result = await Alepha.create()
      .inject(UptimeHttpProber)
      .probe(monitor(`${url}/slow`, { latencyBudgetMs: 1 }));
    expect(result.ok).toBe(true);
    expect(result.result).toBe("latency");
    expect(result.latencyMs).toBeGreaterThanOrEqual(20);
  });

  it("reads certificate expiry from the HTTPS handshake and refuses untrusted TLS", async ({
    expect,
  }) => {
    const url = await serve(true);
    const result = await Alepha.create()
      .inject(TrustedProber)
      .probe(monitor(url));
    expect(result.ok).toBe(true);
    expect(result.certExpiresAt).toBe(
      new Date(new X509Certificate(certificate).validTo).toISOString(),
    );
    expect(
      (await Alepha.create().inject(UptimeHttpProber).probe(monitor(url)))
        .result,
    ).toBe("cert");
  });
});
