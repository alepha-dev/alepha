import type {
  GitHubHttpRequest,
  GitHubHttpResponse,
} from "../api/services/GitHubTransport.ts";
import { GitHubTransport } from "../api/services/GitHubTransport.ts";

/**
 * A scripted answer: a status and a JSON body, or the full response.
 */
export type MemoryGitHubReply =
  | { status?: number; json?: unknown; headers?: Record<string, string> }
  | ((
      request: GitHubHttpRequest,
      match: RegExpExecArray,
    ) => { status?: number; json?: unknown; headers?: Record<string, string> });

/**
 * GitHub for specs (epic #E177): each route answers what a spec scripted,
 * every request is recorded, and an unscripted one is a 404 like GitHub's.
 *
 * ```ts
 * alepha.with({ provide: GitHubTransport, use: MemoryGitHubTransport });
 * const github = alepha.inject(MemoryGitHubTransport);
 * github.on("POST", /^\/app-manifests\/([^/]+)\/conversions$/, { status: 201, json: app });
 * ```
 */
export class MemoryGitHubTransport extends GitHubTransport {
  public readonly requests: GitHubHttpRequest[] = [];

  protected readonly routes: Array<{
    method: string;
    path: RegExp;
    reply: MemoryGitHubReply;
  }> = [];

  on(method: string, path: RegExp, reply: MemoryGitHubReply): this {
    this.routes.unshift({ method, path, reply });
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.length = 0;
  }

  /**
   * The recorded requests whose path matches.
   */
  sent(method: string, path: RegExp): GitHubHttpRequest[] {
    return this.requests.filter(
      (request) =>
        request.method === method &&
        path.test(decodeURIComponent(new URL(request.url).pathname)),
    );
  }

  override async send(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    this.requests.push(request);
    const url = new URL(request.url);
    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = route.path.exec(decodeURIComponent(url.pathname));
      if (!match) continue;
      const reply =
        typeof route.reply === "function"
          ? route.reply(request, match)
          : route.reply;
      return {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json", ...reply.headers },
        body: reply.json === undefined ? "" : JSON.stringify(reply.json),
      };
    }
    return {
      status: 404,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Not Found" }),
    };
  }
}
