import type { Alepha } from "alepha";

/**
 * Builds, in the build's container, the HTTP tables a server only builds on
 * its first fetch (#Q3396): the server links, the router trie and the page
 * tree. `alepha build` loads the app and never starts it, so without this an
 * error they raise (a duplicate action name, an invalid page tree) would move
 * from the build to the first request in production.
 *
 * Reached by the providers' string ids: the build's container is another
 * module graph than the CLI's.
 */
export class BuildTables {
  public force(alepha: Alepha): void {
    this.call(
      alepha,
      "alepha.server.links.ServerLinksProvider",
      "registerLinks",
    );
    this.call(alepha, "alepha.server.links.LinkProvider", "buildServerLinks");
    this.call(alepha, "alepha.server.ServerRouterProvider", "build");
    this.call(alepha, "alepha.react.router.ReactPageProvider", "buildPages");
  }

  protected call(alepha: Alepha, id: string, method: string): void {
    let target: Record<string, unknown> | undefined;
    try {
      target = alepha.inject(id) as Record<string, unknown>;
    } catch {
      // Not in this app: nothing to build.
      return;
    }
    const fn = target[method];
    if (typeof fn === "function") {
      fn.call(target);
    }
  }
}
