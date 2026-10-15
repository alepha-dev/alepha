import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";
import {
  createServer as createSecureServer,
  type ConnectionOptions,
} from "node:tls";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, describe, it } from "vitest";

import { monitors } from "../src/api/entities/monitors.ts";
import { UptimeSocketProber } from "../src/api/services/UptimeSocketProber.ts";

const cert = readFileSync(
  new URL("./fixtures/uptime/cert.pem", import.meta.url),
);
const key = readFileSync(new URL("./fixtures/uptime/key.pem", import.meta.url));

class TrustedProber extends UptimeSocketProber {
  protected override tlsOptions(): ConnectionOptions {
    return { ca: cert };
  }
}

class NoSocketsProber extends UptimeSocketProber {
  protected override supportsSockets(): boolean {
    return false;
  }
}

class NearExpiryClock extends DateTimeProvider {
  public override nowMillis(): number {
    return (
      new Date(new X509Certificate(cert).validTo).getTime() - 5 * 86_400_000
    );
  }
}

const monitor = (target: string, kind: "tcp" | "cert" = "tcp") =>
  monitors.schema.parse({
    id: crypto.randomUUID(),
    projectId: 1,
    createdAt: new Date().toISOString(),
    name: "Socket",
    kind,
    target,
    intervalSecs: 60,
    timeoutSecs: 1,
    confirmations: 2,
    expect: {},
    active: true,
    status: "pending",
    statusSince: "2026-10-15T00:00:00Z",
    failures: 0,
    nextCheckAt: "2026-10-15T00:00:00Z",
  });

describe("Socket uptime probes", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of cleanup.splice(0)) await stop();
  });

  const serve = async (server: Server) => {
    const sockets = new Set<Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const target = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    const stop = () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    cleanup.push(stop);
    return { target, stop };
  };

  it("connects to a TCP listener, measures latency, closes, and reports a refused port", async ({
    expect,
  }) => {
    const { target, stop } = await serve(createServer());
    const prober = Alepha.create().inject(UptimeSocketProber);
    const result = await prober.probe(monitor(target));
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    await stop();
    cleanup.pop();
    const refused = await prober.probe(monitor(target));
    expect(refused.ok).toBe(false);
    expect(refused.result).toBe("connection");
  });

  it("times out a TLS handshake against a listener that stays silent", async ({
    expect,
  }) => {
    const { target } = await serve(createServer());
    const result = await Alepha.create()
      .inject(UptimeSocketProber)
      .probe(monitor(target, "cert"));
    expect(result.result).toBe("timeout");
  });

  it("reports certificate expiry and fails inside the warning window", async ({
    expect,
  }) => {
    const { target } = await serve(createSecureServer({ key, cert }));
    const healthy = await Alepha.create()
      .inject(TrustedProber)
      .probe(monitor(target, "cert"));
    expect(healthy.ok).toBe(true);
    expect(healthy.certDaysRemaining).toBeGreaterThan(14);
    const alepha = Alepha.create().with({
      provide: DateTimeProvider,
      use: NearExpiryClock,
    });
    const warning = await alepha
      .inject(TrustedProber)
      .probe(monitor(target, "cert"));
    expect(warning.ok).toBe(false);
    expect(warning.result).toBe("cert");
    expect(warning.certDaysRemaining).toBe(5);
    expect(warning.certExpiresAt).toBe(
      new Date(new X509Certificate(cert).validTo).toISOString(),
    );
  });

  it("explains an unsupported runtime without opening a socket", async ({
    expect,
  }) => {
    const result = await Alepha.create()
      .inject(NoSocketsProber)
      .probe(monitor("example.test:443"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("self-hosted Node runtime");
  });
});
