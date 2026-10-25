import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { ReactRouter } from "alepha/react/router";

/**
 * One step of the back button's chain: `true` when it consumed the press
 * (it closed an overlay, say), `false` to let the next step have it.
 */
export type BackButtonHandler = () => boolean | Promise<boolean>;

/**
 * What a back press did.
 */
export type BackButtonResult = "handled" | "back" | "exit";

/**
 * The Android back button, as a chain rather than a registry of overlays.
 *
 * A press runs the registered handlers, the last registered first, until one
 * returns `true`; then goes back in the app's history when
 * `ReactRouter.canGoBack` says there is somewhere to go; and only at the root
 * entry exits the app. `canGoBack` counts the app's own entries, so a cold
 * start or a deep link is the root, and back from it exits.
 *
 * The web implementation (this class) listens to nothing and never exits: a
 * browser has its own back button. The native one listens to `@capacitor/app`,
 * which disables the WebView's default back behavior once a listener exists.
 */
export class BackButtonProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly handlers: BackButtonHandler[] = [];

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.unlisten();
    },
  });

  /**
   * Add a step ahead of every step registered before it.
   *
   * @returns a function removing it
   */
  public register(handler: BackButtonHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.lastIndexOf(handler);
      if (index !== -1) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * Run the chain for one press.
   */
  public async press(): Promise<BackButtonResult> {
    for (const handler of this.handlers.toReversed()) {
      try {
        if (await handler()) {
          return "handled";
        }
      } catch (error) {
        // A broken step must not trap the user on the screen.
        this.log.error("A back button handler failed", error);
      }
    }

    // Resolved per press, not injected: the router is the app's, and an app
    // without one still gets the handlers and the exit.
    const router = this.alepha.inject(ReactRouter);
    if (router.canGoBack) {
      await router.back();
      return "back";
    }

    await this.exit();
    return "exit";
  }

  protected async listen(): Promise<void> {}

  protected async unlisten(): Promise<void> {}

  protected async exit(): Promise<void> {}
}
