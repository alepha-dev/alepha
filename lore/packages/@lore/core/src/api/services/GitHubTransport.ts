import { ServiceUnavailableError } from "alepha/server";

/**
 * One request to GitHub, as the transport sends it.
 */
export interface GitHubHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * GitHub's answer, read whole: status, lower-cased headers, body text.
 */
export interface GitHubHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * The one place Lore's GitHub integration calls `fetch` (epic #E177).
 *
 * Plain `fetch`, on workerd and Node alike, with no SDK. Everything above it
 * (`GitHubClient`, the manifest conversion, the user code exchange) builds
 * the request and reads the answer; this sends it.
 *
 * ⚠️ A request may carry a token in its headers, so this class has no
 * logger, and a network failure becomes a `ServiceUnavailableError` that
 * names GitHub and nothing of the request.
 *
 * The seam for specs: `alepha.with({ provide: GitHubTransport, use:
 * MemoryGitHubTransport })` (`@lore/core/testing`), never `vi.mock`.
 */
export class GitHubTransport {
  /**
   * GitHub gives up on Lore's webhook after 10 s; Lore gives GitHub's API as
   * long, so a hung connection never holds a request open.
   */
  public static readonly TIMEOUT_MS = 10_000;

  async send(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    let response: Response;
    try {
      response = await globalThis.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(GitHubTransport.TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableError("GitHub could not be reached");
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, headers, body: await response.text() };
  }
}
