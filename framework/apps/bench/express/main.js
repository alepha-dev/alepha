// Express 5 doing the same job as src/app.ts:
// - zod validation of params, query and body, and of the response (Alepha
//   validates responses outside production; in production it shapes and
//   type-checks them, without the constraint checks this one still runs)
// - JSON body parsing
// - the same four security headers as ServerHelmetProvider (helmet, trimmed to them)
// - compression: 1 KiB threshold, brotli q4 (the `compression` defaults)
// - a request id (x-request-id or randomUUID) held in AsyncLocalStorage for the request
// - an AbortSignal aborted when the client disconnects
// - one JSON log line per request ("Request completed", with agent and ip, as
//   Alepha writes in production), written synchronously to stdout, with key
//   redaction
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import compression from "compression";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import { z } from "zod";

const log = pino(
  {
    base: { service: "ServerLoggerProvider", module: "alepha.server" },
    messageKey: "message",
    timestamp: () => `,"time":${Date.now()}`,
    formatters: { level: (label) => ({ level: label.toUpperCase() }) },
    redact: [
      "data.authorization",
      "data.cookie",
      "data.password",
      "data.token",
    ],
  },
  pino.destination({ dest: 1, sync: true }),
);

const als = new AsyncLocalStorage();

const app = express();
app.disable("x-powered-by");
app.disable("etag");

// request id, ALS context, abort signal, logs
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
app.use(express.json());

const USERS = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `User number ${i + 1}`,
  email: `user${i + 1}@example.com`,
  age: 20 + (i % 50),
}));

const helloResponse = z.object({ message: z.string().trim().max(255) });
const userParams = z.object({ id: z.coerce.number().int() });
const userQuery = z.object({ expand: z.stringbool().optional() });
const userResponse = z.object({
  id: z.number().int(),
  name: z.string().trim().max(255),
  expand: z.boolean(),
});
const createBody = z.object({
  name: z.string().trim().max(255),
  email: z.string().trim().max(255),
  age: z.number().int(),
});
const createResponse = z.object({
  id: z.number().int(),
  name: z.string().trim().max(255),
  email: z.string().trim().max(255),
  age: z.number().int(),
});
const listResponse = z.array(createResponse);

const send = (res, schema, value) => res.json(schema.parse(value));

const validate = (schema, value, res) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    res
      .status(400)
      .json({ name: "BAD_REQUEST", message: result.error.message });
    return undefined;
  }
  return result.data;
};

app.get("/ping", (_req, res) => {
  res.type("text/plain").send("pong");
});

app.get("/api/hello", (_req, res) => {
  send(res, helloResponse, { message: "Hello, world!" });
});

app.get("/api/users/:id", (req, res) => {
  const params = validate(userParams, req.params, res);
  if (!params) return;
  const query = validate(userQuery, req.query, res);
  if (!query) return;
  send(res, userResponse, {
    id: params.id,
    name: `user ${params.id}`,
    expand: query.expand ?? false,
  });
});

app.get("/api/users", (_req, res) => {
  send(res, listResponse, USERS);
});

app.post("/api/users", (req, res) => {
  const body = validate(createBody, req.body, res);
  if (!body) return;
  send(res, createResponse, { id: 1, ...body });
});

app.listen(
  Number(process.env.SERVER_PORT ?? 3391),
  process.env.SERVER_HOST ?? "127.0.0.1",
);
