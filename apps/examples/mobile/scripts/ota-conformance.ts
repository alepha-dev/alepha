/**
 * The OTA conformance harness of #Q2524: the pinned updater
 * (`@capgo/capacitor-updater` 8.52.1) on a simulator or an emulator, against
 * a local fixture service, with no Capgo account, no `ota-api` and no app
 * code in between.
 *
 * It serves, over HTTPS (an mkcert pair the device trusts, `OTA_TLS_CERT`
 * and `OTA_TLS_KEY`, on `OTA_PORT`, 8444 by default):
 *
 * - the plugin's endpoints, `POST /ota/updates`, `POST /ota/stats` and
 *   `POST|PUT|GET /ota/channel`, logging every request body as it arrived
 *   (the captures the wire fixtures are checked against) and answering the
 *   next queued answer, `no_new_version_available` when none is queued;
 * - bundles made at start by the publisher's own code (`OtaArchiveWriter`,
 *   `OtaEnvelope`) with a TEST-ONLY key pair kept in
 *   `node_modules/.ota-conformance/`: `healthy-2` and `healthy-4` (harness
 *   pages that acknowledge), `broken-3` (renders, never acknowledges),
 *   `wrongkey-5` (sealed with another key), `tampered-6` (one ciphertext
 *   byte flipped), `checksum-7` (another bundle's checksum);
 * - the harness page itself, `GET /harness.html?version=builtin`, to copy
 *   into the native projects as the built-in web layer.
 *
 * The harness page polls `GET /harness/command` and runs each queued command
 * against the plugin over the Capacitor bridge, posting the outcome to
 * `/harness/result`. Drive it with:
 *
 * ```bash
 * curl -k -XPOST https://localhost:8444/control/command -d '{"op":"getLatest"}'
 * curl -k -XPOST https://localhost:8444/control/answer -d '{"bundle":"healthy-2"}'
 * curl -k https://localhost:8444/control/log
 * ```
 *
 * `{"bundle": name}` queues an update answer for that bundle, `{"body",
 * "status"}` any answer. `/control/bundle?name=` returns a bundle's download
 * options, for a `download` command.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { join } from "node:path";

import { OtaArchiveWriter } from "../../../../packages/@alepha/capacitor/src/cli/services/OtaArchiveWriter.ts";
import { OtaEnvelope } from "../../../../packages/@alepha/capacitor/src/cli/services/OtaEnvelope.ts";

const APP_ROOT = new URL("..", import.meta.url).pathname;
const STATE = join(APP_ROOT, "node_modules", ".ota-conformance");
const PORT = Number(process.env.OTA_PORT ?? 8444);
const ORIGIN = process.env.OTA_ORIGIN ?? `https://localhost:${PORT}`;
const envelope = new OtaEnvelope();
const writer = new OtaArchiveWriter();

mkdirSync(STATE, { recursive: true });
const keysFile = join(STATE, "TEST-ONLY-keys.json");
let keys: { publicKey: string; privateKey: string; other: string };
try {
  keys = JSON.parse(readFileSync(keysFile, "utf-8"));
} catch {
  const pair = envelope.generateKeyPair();
  keys = { ...pair, other: envelope.generateKeyPair().privateKey };
  writeFileSync(keysFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

const harness = (version: string, acknowledge: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui;padding:48px 16px">
<h1 id="version">${version}</h1><p>OTA conformance harness</p>
<script>
const SERVER = ${JSON.stringify(ORIGIN)};
const VERSION = ${JSON.stringify(version)};
const call = (method, options) => window.Capacitor.nativePromise("CapacitorUpdater", method, options || {});
const post = (path, body) => fetch(SERVER + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
const started = performance.now();
(async () => {
  ${acknowledge ? 'const ready = await call("notifyAppReady"); await post("/harness/result", { version: VERSION, op: "notifyAppReady", ok: true, result: ready, ms: Math.round(performance.now() - started) });' : ""}
  await post("/harness/result", { version: VERSION, op: "boot", platform: window.Capacitor.getPlatform() });
  for (;;) {
    try {
      const command = await (await fetch(SERVER + "/harness/command?version=" + encodeURIComponent(VERSION))).json();
      if (command.op !== "wait") {
        try {
          const result = await call(command.op, command.args);
          await post("/harness/result", { version: VERSION, op: command.op, ok: true, result });
        } catch (error) {
          await post("/harness/result", { version: VERSION, op: command.op, ok: false, error: String((error && error.message) || error) });
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})();
</script></body></html>`;

const zip = (html: string) =>
  writer.write([{ path: "index.html", data: new TextEncoder().encode(html) }]);

const bundles = new Map<
  string,
  {
    version: string;
    ciphertext: Uint8Array;
    sessionKey: string;
    checksum: string;
  }
>();
const add = (
  name: string,
  version: string,
  sealed: { ciphertext: Uint8Array; sessionKey: string; checksum: string },
) => bundles.set(name, { version, ...sealed });

add(
  "healthy-2",
  "conf-2",
  envelope.seal(zip(harness("conf-2", true)), keys.privateKey),
);
add(
  "healthy-4",
  "conf-4",
  envelope.seal(zip(harness("conf-4", true)), keys.privateKey),
);
add(
  "broken-3",
  "conf-3",
  envelope.seal(
    zip('<!doctype html><h1 id="version">conf-3 broken</h1>'),
    keys.privateKey,
  ),
);
add(
  "wrongkey-5",
  "conf-5",
  envelope.seal(zip(harness("conf-5", true)), keys.other),
);
{
  const sealed = envelope.seal(zip(harness("conf-6", true)), keys.privateKey);
  const ciphertext = sealed.ciphertext.slice();
  ciphertext[100] ^= 0xff;
  add("tampered-6", "conf-6", { ...sealed, ciphertext });
}
{
  const sealed = envelope.seal(zip(harness("conf-7", true)), keys.privateKey);
  add("checksum-7", "conf-7", {
    ...sealed,
    checksum: envelope.seal(zip("<p>other</p>"), keys.privateKey).checksum,
  });
}

const download = (name: string) => {
  const bundle = bundles.get(name);
  if (!bundle) {
    return undefined;
  }
  return {
    url: `${ORIGIN}/bundles/${name}.zip`,
    version: bundle.version,
    sessionKey: bundle.sessionKey,
    checksum: bundle.checksum,
  };
};

const log: unknown[] = [];
const record = (entry: Record<string, unknown>) => {
  const line = { at: new Date().toISOString(), ...entry };
  log.push(line);
  console.log(JSON.stringify(line));
};
const answers: Array<{ status: number; body: unknown }> = [];
const commands: unknown[] = [];

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });

const send = (
  res: ServerResponse,
  status: number,
  body: unknown,
  type = "application/json",
) => {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(
    typeof body === "string" || body instanceof Uint8Array
      ? body
      : JSON.stringify(body),
  );
};

createServer(
  {
    cert: readFileSync(process.env.OTA_TLS_CERT ?? ""),
    key: readFileSync(process.env.OTA_TLS_KEY ?? ""),
  },
  async (req, res) => {
    const url = new URL(req.url ?? "/", ORIGIN);
    const raw =
      req.method === "GET" || req.method === "OPTIONS" ? "" : await read(req);
    const body = raw ? JSON.parse(raw) : undefined;
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return send(res, 204, "");
    }
    if (path === "/ota/updates") {
      record({ kind: "request", method: req.method, path, body });
      const answer = answers.shift() ?? {
        status: 200,
        body: {
          error: "no_new_version_available",
          message: "No new version available",
          kind: "up_to_date",
        },
      };
      record({ kind: "answer", path, ...answer });
      return send(res, answer.status, answer.body);
    }
    if (path === "/ota/stats") {
      record({ kind: "request", method: req.method, path, body });
      return send(res, 200, { status: "ok" });
    }
    if (path === "/ota/channel") {
      record({
        kind: "request",
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        body,
      });
      if (req.method === "POST") {
        return body?.channel === "beta"
          ? send(res, 200, { status: "ok", message: "Channel set to beta" })
          : send(res, 403, {
              status: "error",
              error: "channel_self_set_not_allowed",
              message: "Not self-assignable",
            });
      }
      if (req.method === "PUT") {
        return send(res, 200, {
          channel: "production",
          status: "default",
          allowSet: true,
        });
      }
      return send(res, 200, [
        { id: 1, name: "beta", public: false, allow_self_set: true },
      ]);
    }
    if (path.startsWith("/bundles/")) {
      const bundle = bundles.get(
        path.slice("/bundles/".length).replace(/\.zip$/, ""),
      );
      record({ kind: "download", path, found: !!bundle });
      return bundle
        ? send(res, 200, bundle.ciphertext, "application/zip")
        : send(res, 404, { error: "not_found" });
    }
    if (path === "/harness.html") {
      return send(
        res,
        200,
        harness(url.searchParams.get("version") ?? "builtin", false),
        "text/html",
      );
    }
    if (path === "/harness/command") {
      return send(res, 200, commands.shift() ?? { op: "wait" });
    }
    if (path === "/harness/result") {
      record({ kind: "result", ...body });
      return send(res, 200, { status: "ok" });
    }
    if (path === "/control/command") {
      commands.push(body);
      return send(res, 200, { queued: commands.length });
    }
    if (path === "/control/answer") {
      answers.push(
        body.bundle
          ? {
              status: 200,
              body: (({ url, version, sessionKey, checksum }) => ({
                version,
                url,
                session_key: sessionKey,
                checksum,
              }))(download(body.bundle)!),
            }
          : { status: body.status ?? 200, body: body.body },
      );
      return send(res, 200, { queued: answers.length });
    }
    if (path === "/control/bundle") {
      return send(
        res,
        200,
        download(url.searchParams.get("name") ?? "") ?? { error: "unknown" },
      );
    }
    if (path === "/control/log") {
      return send(res, 200, log);
    }
    if (path === "/control/public-key") {
      return send(res, 200, keys.publicKey, "text/plain");
    }
    return send(res, 404, { error: "not_found" });
  },
).listen(PORT, "0.0.0.0", () => {
  console.log(
    `OTA conformance harness on ${ORIGIN}, key id ${envelope.keyId(keys.publicKey)}`,
  );
});
