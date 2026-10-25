import { BackButtonProvider } from "@alepha/capacitor";
import { $hook, $inject } from "alepha";

/**
 * The Android back button closes the open overlay before it navigates.
 *
 * `@alepha/ui` keeps no registry of open overlays: each Base UI popup owns its
 * state and closes on Escape. So the step is a probe, not a registry: when an
 * open popup is on the page, Escape goes to the focused element (a popup
 * traps focus inside itself) and the press is consumed. Registered from the
 * browser entry only, since the server has no back button.
 */
export class OverlayBackHandler {
  protected readonly back = $inject(BackButtonProvider);
  protected unregister?: () => void;

  protected readonly onReady = $hook({
    on: "ready",
    handler: () => {
      this.unregister = this.back.register(() => this.closeOverlay());
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => {
      this.unregister?.();
    },
  });

  protected closeOverlay(): boolean {
    const open = document.querySelector(
      ':is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])[data-open]',
    );
    if (!open) {
      return false;
    }
    const target = document.activeElement ?? open;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  }
}
