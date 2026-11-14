import type { RequestOptions } from "node:https";
import type { TLSSocket } from "node:tls";

import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { Monitor } from "../entities/monitors.ts";
import type { ProbeResult } from "../schemas/probeResultSchema.ts";

/**
 * A GET check without storage, scheduling or notifications.
 */
export class UptimeHttpProber {
  protected readonly alepha = $inject(Alepha);
  protected readonly clock = $inject(DateTimeProvider);

  public async probe(monitor: Monitor): Promise<ProbeResult> {
    const started = this.clock.nowMillis();
    const latency = () => Math.max(0, this.clock.nowMillis() - started);
    try {
      const url = new URL(monitor.target);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new AlephaError("HTTP monitors require an http or https URL");
      }
      const response: { status: number; body: string; certExpiresAt?: string } =
        this.alepha.meta.build.runtime === "workerd"
          ? await this.fetchResponse(url, monitor)
          : await this.nodeResponse(url, monitor);
      const base = {
        latencyMs: latency(),
        certExpiresAt: response.certExpiresAt,
      };
      const expected = monitor.expect.status;
      if (
        expected === undefined
          ? response.status < 200 || response.status >= 300
          : response.status !== expected
      ) {
        return {
          ...base,
          ok: false,
          result: "status",
          error: `HTTP ${response.status}; expected ${expected ?? "2xx"}`,
        };
      }
      if (
        monitor.expect.keyword &&
        !response.body.includes(monitor.expect.keyword)
      ) {
        return {
          ...base,
          ok: false,
          result: "keyword",
          error: "Response does not contain the expected keyword",
        };
      }
      if (
        monitor.expect.latencyBudgetMs &&
        base.latencyMs > monitor.expect.latencyBudgetMs
      ) {
        return {
          ...base,
          ok: true,
          result: "latency",
          error: `Response took ${base.latencyMs} ms; budget is ${monitor.expect.latencyBudgetMs} ms`,
        };
      }
      return { ...base, ok: true, result: "up" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && "code" in error ? String(error.code) : "";
      return {
        ok: false,
        latencyMs: latency(),
        result:
          message === "Probe timed out" ||
          (error instanceof DOMException && error.name === "TimeoutError")
            ? "timeout"
            : /CERT|TLS|SSL/.test(code)
              ? "cert"
              : "connection",
        error: message.slice(0, 4096),
      };
    }
  }

  protected requestOptions(): RequestOptions {
    return {};
  }

  protected async nodeResponse(
    url: URL,
    monitor: Monitor,
  ): Promise<{ status: number; body: string; certExpiresAt?: string }> {
    const http =
      url.protocol === "https:"
        ? await import("node:https")
        : await import("node:http");
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => request.destroy(new AlephaError("Probe timed out")),
        monitor.timeoutSecs * 1000,
      );
      const finish = (
        error?: Error,
        response?: { status: number; body: string; certExpiresAt?: string },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (response) resolve(response);
      };
      const request = http.request(
        url,
        { ...this.requestOptions(), method: "GET", agent: false },
        (response) => {
          const socket = response.socket as TLSSocket;
          const certificate =
            url.protocol === "https:" ? socket.getPeerCertificate() : undefined;
          const expiry = certificate?.valid_to
            ? new Date(certificate.valid_to)
            : undefined;
          const certExpiresAt =
            expiry && Number.isFinite(expiry.getTime())
              ? expiry.toISOString()
              : undefined;
          const result = {
            status: response.statusCode ?? 0,
            body: "",
            certExpiresAt,
          };
          const statusMatches =
            monitor.expect.status === undefined
              ? result.status >= 200 && result.status < 300
              : result.status === monitor.expect.status;
          if (!monitor.expect.keyword || !statusMatches) {
            finish(undefined, result);
            response.destroy();
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) {
              request.destroy(
                new AlephaError(
                  "Response exceeds the 2 MiB keyword scan limit",
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            finish(undefined, {
              ...result,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          response.on("error", (error) => finish(error));
          response.on("aborted", () =>
            finish(
              new AlephaError("Response ended before the body was complete"),
            ),
          );
        },
      );
      request.on("error", (error) => finish(error));
      request.end();
    });
  }

  protected async fetchResponse(
    url: URL,
    monitor: Monitor,
  ): Promise<{ status: number; body: string }> {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(monitor.timeoutSecs * 1000),
    });
    const statusMatches =
      monitor.expect.status === undefined
        ? response.status >= 200 && response.status < 300
        : response.status === monitor.expect.status;
    if (!monitor.expect.keyword || !statusMatches) {
      await response.body?.cancel();
      return { status: response.status, body: "" };
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 2 * 1024 * 1024)
            throw new AlephaError(
              "Response exceeds the 2 MiB keyword scan limit",
            );
          chunks.push(next.value);
        }
      }
    } finally {
      await reader?.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { status: response.status, body: new TextDecoder().decode(bytes) };
  }
}
