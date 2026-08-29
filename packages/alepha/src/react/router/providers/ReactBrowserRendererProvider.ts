import { $hook } from "alepha";
import { $logger } from "alepha/logger";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";

/**
 * Browser specific React renderer (react-dom/client interface)
 */
export class ReactBrowserRendererProvider {
  protected readonly log = $logger();
  protected root?: Root;

  /**
   * Stamped on `<html>` once React has taken over the server-rendered DOM.
   *
   * It exists for end-to-end tests, which otherwise have nothing to wait on
   * between "the document loaded" and "the app is interactive" and reach for a
   * fixed sleep instead. A sleep is both slower than it needs to be and flaky
   * under load; this is the condition those tests actually mean.
   *
   * Set only on the hydration path: on a client-rendered boot there is no
   * server HTML to take over, and the app's own markup appearing is already
   * the signal.
   *
   * ⚠️ It means "the hydrating render returned", which is the same claim the
   * `Hydrated root element` log line makes. Alepha resolves a route's layers
   * before rendering, so that render is not suspended and React flushes it
   * synchronously — but a tree that DOES suspend during hydration would set
   * this while part of it is still server HTML.
   */
  static readonly HYDRATED_ATTRIBUTE = "data-alepha-hydrated";

  protected readonly onBrowserRender = $hook({
    on: "react:browser:render",
    handler: async ({ hydration, root, element }) => {
      if (hydration?.["alepha.react.router.layers"]) {
        this.root = hydrateRoot(root, element);
        document.documentElement.setAttribute(
          ReactBrowserRendererProvider.HYDRATED_ATTRIBUTE,
          "true",
        );
        this.log.info("Hydrated root element");
      } else {
        this.root ??= createRoot(root);
        this.root.render(element);
        this.log.info("Created root element");
      }
    },
  });
}
