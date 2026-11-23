import { $hook } from "alepha";

/**
 * A `.git` URL opened in a browser lands on the repository's page (#Q4133):
 * `GET /<project>.git` goes to `/<project>/code`, `GET
 * /<project>/<repo>.git` to `/<project>/code/<repo>`, with a 302.
 *
 * A hook rather than a `$route`: a route on `/:repo` or `/:project/:repo`
 * would shadow the project's pages, and one in `GitHttpController` would
 * break its purity (`pure-controllers.spec.ts`). Only a browser is sent on:
 * a GET whose `Accept` names `text/html`, from anything but git (`git/...`).
 * git asks for `/info/refs` and the RPCs, never the bare `.git` URL, so
 * smart HTTP is untouched either way.
 */
export class GitBrowserRedirect {
  public readonly onRequest = $hook({
    on: "server:request:before",
    handler: ({ request }) => {
      const target = GitBrowserRedirect.targetOf(
        request.method,
        request.url.pathname,
        request.headers.accept,
        request.headers["user-agent"],
      );
      if (target) request.reply.redirect(target, 302);
    },
  });

  /**
   * Where a browser opening `pathname` should go, or undefined.
   */
  public static targetOf(
    method: string | undefined,
    pathname: string,
    accept: string | undefined,
    userAgent: string | undefined,
  ): string | undefined {
    if (method !== "GET") return undefined;
    if (!accept?.includes("text/html")) return undefined;
    if (userAgent?.startsWith("git/")) return undefined;
    const match =
      /^\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?))?\.git\/?$/.exec(
        pathname,
      );
    if (!match) return undefined;
    const [, project, repo] = match;
    return repo ? `/${project}/code/${repo}` : `/${project}/code`;
  }
}
