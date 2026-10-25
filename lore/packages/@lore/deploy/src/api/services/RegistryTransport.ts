/**
 * The one place `ImageRegistryClient` touches the network.
 *
 * A class with a single method rather than a bare `fetch` call inside the
 * client, for the reason every other seam in this app is one: the client's
 * real work is parsing a reference, choosing an architecture, normalising a
 * digest and refusing six named failures, and none of that should need ghcr
 * to be reachable to be tested. A spec substitutes this through
 * `Alepha.with({ provide, use })` and serves recorded documents.
 *
 * ⚠️ **It does not follow redirects.** `redirect: "manual"` is the default
 * here on purpose: ghcr answers a blob request with a 307 to
 * `pkg-containers.githubusercontent.com`, and `fetch`'s automatic follow
 * re-sends every header - including the bearer token - to that second host.
 * The client follows the hop itself, without the Authorization header. A
 * caller that wants the automatic behaviour has to ask for it.
 */
export class RegistryTransport {
  async fetch(url: string, init: RegistryRequest): Promise<Response> {
    return await globalThis.fetch(url, {
      method: "GET",
      headers: init.headers,
      redirect: init.redirect ?? "manual",
    });
  }
}

export interface RegistryRequest {
  headers: Record<string, string>;
  redirect?: RequestRedirect;
}
