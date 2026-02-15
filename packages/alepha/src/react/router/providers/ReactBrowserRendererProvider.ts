import { $hook } from "alepha";
import { $logger } from "alepha/logger";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";

/**
 * Browser specific React renderer (react-dom/client interface)
 */
export class ReactBrowserRendererProvider {
  protected readonly log = $logger();
  protected root?: Root;

  protected readonly onBrowserRender = $hook({
    on: "react:browser:render",
    handler: async ({ hydration, root, element }) => {
      if (hydration?.["alepha.react.router.layers"]) {
        this.root = hydrateRoot(root, element);
        this.log.info("Hydrated root element");
      } else {
        this.root ??= createRoot(root);
        this.root.render(element);
        this.log.info("Created root element");
      }
    },
  });
}
