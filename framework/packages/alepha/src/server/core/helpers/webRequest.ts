import { AlephaError } from "alepha";

import type { ServerRawRequest } from "../interfaces/ServerRequest.ts";

/**
 * The whole body of a request that nothing has read yet, as the exact bytes
 * received.
 *
 * Web-request runtimes (Bun, workerd) read it with the native
 * `arrayBuffer()`; the Node server drains the `IncomingMessage` stream.
 * Nothing is parsed or re-encoded, so a signature computed over the bytes a
 * sender wrote still verifies. Only meaningful on a route declared without
 * `schema.body`: a body schema has already consumed the stream.
 *
 * Returns `undefined` when the request carries neither raw side (a direct
 * `$action` call, a test).
 */
export const readRawBody = async (
  raw: ServerRawRequest | undefined,
): Promise<Uint8Array | undefined> => {
  const web = raw?.web?.req;
  if (web) {
    return new Uint8Array(await web.arrayBuffer());
  }
  const node = raw?.node?.req;
  if (!node) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of node as AsyncIterable<Uint8Array | string>) {
    const bytes =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    chunks.push(bytes);
    size += bytes.byteLength;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

/**
 * A web `Request` for the request a route received, on every server.
 *
 * Bun and workerd hand the route one already, and it is returned as is. The
 * Node server only carries an `IncomingMessage`: a `Request` is built from
 * it, with its headers copied and its body buffered as the exact bytes
 * received ({@link readRawBody}), so a provider that verifies a signature
 * over them reads what the sender signed.
 *
 * Throws an `AlephaError` when the request has neither raw side.
 */
export const toWebRequest = async (
  url: URL,
  raw: ServerRawRequest | undefined,
): Promise<Request> => {
  if (raw?.web?.req) {
    return raw.web.req;
  }

  const nodeReq = raw?.node?.req;
  if (!nodeReq) {
    throw new AlephaError(
      "No raw request to convert: the request came from neither the Node server nor a web-request runtime",
    );
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = (nodeReq.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    body: hasBody ? ((await readRawBody(raw)) as BodyInit) : undefined,
  });
};
