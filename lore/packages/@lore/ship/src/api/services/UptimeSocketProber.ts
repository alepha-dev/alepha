import type { Socket } from "node:net";
import type { ConnectionOptions, TLSSocket } from "node:tls";

import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { Monitor } from "../entities/monitors.ts";
import type { ProbeResult } from "../schemas/probeResultSchema.ts";

/**
 * Node socket probes. A runtime without sockets returns an explicit failure.
 */
export class UptimeSocketProber {
  protected readonly alepha = $inject(Alepha);
  protected readonly clock = $inject(DateTimeProvider);

  protected supportsSockets(): boolean {
    return this.alepha.meta.build.runtime !== "workerd";
  }

  protected tlsOptions(): ConnectionOptions {
    return {};
  }

  public async probe(monitor: Monitor): Promise<ProbeResult> {
    const started = this.clock.nowMillis();
    const latency = () => Math.max(0, this.clock.nowMillis() - started);
    if (!this.supportsSockets()) {
      return {
        ok: false,
        result: "connection",
        latencyMs: 0,
        error:
          "TCP and certificate monitors require the self-hosted Node runtime with socket support",
      };
    }
    try {
      const target = new URL(`tcp://${monitor.target}`);
      const host = target.hostname.replace(/^\[|\]$/g, "");
      const port = target.port
        ? Number(target.port)
        : monitor.kind === "cert"
          ? 443
          : 0;
      if (
        !host ||
        !port ||
        port > 65535 ||
        target.username ||
        target.password ||
        target.pathname ||
        target.search ||
        target.hash
      ) {
        throw new AlephaError(
          "Socket targets must be host:port (certificate checks default to port 443)",
        );
      }
      const net = await import("node:net");
      const tls =
        monitor.kind === "cert" ? await import("node:tls") : undefined;
      return await new Promise<ProbeResult>((resolve) => {
        let socket: Socket | undefined;
        let settled = false;
        const finish = (result: Omit<ProbeResult, "latencyMs">) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket?.destroy();
          resolve({ ...result, latencyMs: latency() });
        };
        const timer = setTimeout(
          () =>
            finish({
              ok: false,
              result: "timeout",
              error: "Socket probe timed out",
            }),
          monitor.timeoutSecs * 1000,
        );
        try {
          if (tls) {
            socket = tls.connect(
              {
                ...this.tlsOptions(),
                host,
                port,
                servername: net.isIP(host) ? undefined : host,
                rejectUnauthorized: false,
              },
              () => {
                const secured = socket as TLSSocket;
                const certificate = secured.getPeerCertificate();
                const expiry = new Date(certificate.valid_to);
                if (!Number.isFinite(expiry.getTime())) {
                  finish({
                    ok: false,
                    result: "cert",
                    error: "The peer did not provide a certificate expiry",
                  });
                  return;
                }
                const certExpiresAt = expiry.toISOString();
                const certDaysRemaining =
                  (expiry.getTime() - this.clock.nowMillis()) / 86_400_000;
                if (!secured.authorized) {
                  finish({
                    ok: false,
                    result: "cert",
                    certExpiresAt,
                    certDaysRemaining,
                    error: String(secured.authorizationError).slice(0, 4096),
                  });
                } else if (
                  certDaysRemaining <= (monitor.expect.certWarningDays ?? 14)
                ) {
                  finish({
                    ok: false,
                    result: "cert",
                    certExpiresAt,
                    certDaysRemaining,
                    error: `Certificate expires in ${Math.floor(certDaysRemaining)} days; warning threshold is ${monitor.expect.certWarningDays ?? 14} days`,
                  });
                } else {
                  finish({
                    ok: true,
                    result: "up",
                    certExpiresAt,
                    certDaysRemaining,
                  });
                }
              },
            );
          } else {
            socket = net.createConnection({ host, port }, () =>
              finish({ ok: true, result: "up" }),
            );
          }
          socket.on("close", () =>
            finish({
              ok: false,
              result: "connection",
              error: "Socket closed before the check completed",
            }),
          );
          socket.on("error", (error: NodeJS.ErrnoException) =>
            finish({
              ok: false,
              result: error.code === "ETIMEDOUT" ? "timeout" : "connection",
              error: error.message.slice(0, 4096),
            }),
          );
        } catch (error) {
          finish({
            ok: false,
            result: "connection",
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 4096),
          });
        }
      });
    } catch (error) {
      return {
        ok: false,
        result: "connection",
        latencyMs: latency(),
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          4096,
        ),
      };
    }
  }
}
