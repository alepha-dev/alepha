// Express 5 serving the same page as src/RowsRouter.ts:
// - the same component (src/UserTable.ts), rendered on every request with
//   react-dom's renderToPipeableStream, streamed as soon as the shell is ready
// - the same document: doctype, head with title and the module script, the
//   rendered root, and the loader data as a JSON script for hydration
// - the same headers: no-store caching, helmet's four, a modulepreload link
// - compression above 1 KiB, brotli q4 (the `compression` defaults)
// - a request id held in AsyncLocalStorage, an AbortSignal on disconnect
// - one JSON log line per request, written synchronously to stdout
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import compression from "compression";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";

import { USERS } from "../src/users.ts";
import UserTable from "../src/UserTable.ts";

const log = pino(
  {
    base: { service: "ServerLoggerProvider", module: "alepha.server" },
    messageKey: "message",
    timestamp: () => `,"time":${Date.now()}`,
    formatters: { level: (label) => ({ level: label.toUpperCase() }) },
  },
  pino.destination({ dest: 1, sync: true }),
);

const als = new AsyncLocalStorage();

const app = express();
app.disable("x-powered-by");
app.disable("etag");

app.use((req, res, next) => {
  const context = req.headers["x-request-id"] || randomUUID();
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  req.abortSignal = controller.signal;
  const start = Date.now();
  als.run({ context }, () => {
    res.once("finish", () => {
      log.info(
        {
          context,
          data: {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            duration: Date.now() - start,
            agent: req.headers["user-agent"],
            ip: req.ip,
          },
        },
        "Request completed",
      );
    });
    next();
  });
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
    xDnsPrefetchControl: false,
    xDownloadOptions: false,
    xPermittedCrossDomainPolicies: false,
    xXssProtection: false,
    strictTransportSecurity: { maxAge: 15552000, includeSubDomains: true },
    xFrameOptions: { action: "sameorigin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);
app.use(compression());

const HEAD = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="module" crossorigin="" src="/entry.js" async></script>
<link rel="modulepreload" href="/chunk.js">
<title>Users</title>
</head>
<body>
<div id="root">`;

// `<` escaped as Alepha's state script escapes it, so the JSON cannot close
// its own tag.
const state = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

app.get("/", (_req, res) => {
  const data = { rows: USERS };
  res.setHeader("content-type", "text/html");
  res.setHeader(
    "cache-control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("pragma", "no-cache");
  res.setHeader("expires", "0");
  res.setHeader("link", "</entry.js>; rel=modulepreload");
  const { pipe } = renderToPipeableStream(createElement(UserTable, data), {
    onShellReady() {
      res.write(HEAD);
      pipe(res);
    },
    onAllReady() {},
    onError(error) {
      res.statusCode = 500;
      log.error({ data: { error: String(error) } }, "Render failed");
    },
  });
  // renderToPipeableStream ends the response when the root is written; the
  // tail is written by wrapping end once.
  const end = res.end.bind(res);
  res.end = (...args) => {
    res.end = end;
    res.write(
      `</div><script id="__ssr" type="application/json">${state({ layers: [{ data }] })}</script></body>\n</html>`,
    );
    return end(...args);
  };
});

app.listen(
  Number(process.env.SERVER_PORT ?? 3392),
  process.env.SERVER_HOST ?? "127.0.0.1",
);
