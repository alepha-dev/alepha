import { Alepha } from "alepha";
import { currentUserAtom } from "alepha/security";
import { describe, expect, it } from "vitest";

import { $settingsDialog } from "../$settingsDialog.ts";
import { $settingsSection } from "../$settingsSection.ts";
import { settingsDialogsAtom } from "../SettingsDialogs.ts";

class AccountSettings {
  dialog = $settingsDialog({ name: "account", title: "Account" });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    lazy: () => Promise.resolve({ default: () => null }),
  });
}

/**
 * `?account=` is read in the browser only: the streaming SSR render must not
 * open a dialog (or redirect) on the server's copy of the store.
 */
describe("SettingsDialogs on the server", () => {
  it("ignores ?<dialogName>= during a server transition", async () => {
    const alepha = Alepha.create();
    alepha.inject(AccountSettings);
    await alepha.start();
    alepha.store.set(currentUserAtom, { id: "u1" } as never);

    await alepha.events.emit("react:transition:end", {
      state: { url: new URL("http://localhost/?account=profile") },
    } as never);

    expect(alepha.store.get(settingsDialogsAtom)?.open).toBeUndefined();
    await alepha.stop();
  });
});
