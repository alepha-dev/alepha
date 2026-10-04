import { $hook, $inject, Alepha } from "alepha";

/**
 * Whether the app is in the foreground, and the event when that changes.
 *
 * Emits `capacitor:app:state` with `{ active }` on every change. The web
 * implementation (this class) follows the document's visibility; the native
 * one follows `@capacitor/app`. Both start listening when the container
 * starts and stop when it stops.
 */
export class AppStateProvider {
  protected readonly alepha = $inject(Alepha);
  protected active = true;

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

  public isActive(): boolean {
    return this.active;
  }

  protected readonly onVisibility = () => {
    void this.update(document.visibilityState === "visible");
  };

  protected async listen(): Promise<void> {
    if (typeof document === "undefined") {
      return;
    }
    this.active = document.visibilityState !== "hidden";
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  protected async unlisten(): Promise<void> {
    if (typeof document === "undefined") {
      return;
    }
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  protected async update(active: boolean): Promise<void> {
    if (active === this.active) {
      return;
    }
    this.active = active;
    await this.alepha.events.emit("capacitor:app:state", { active });
  }
}
