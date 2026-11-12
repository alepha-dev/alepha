import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { $settingsDialog } from "../$settingsDialog.ts";
import { $settingsSection } from "../$settingsSection.ts";
import { DialogProvider, useDialog } from "../../core/useDialog.tsx";
import { SettingsDialogs, settingsDialogsAtom } from "../SettingsDialogs.ts";

const Profile = () => <p>Profile body</p>;

const Sessions = () => {
  const dialog = useDialog();
  return (
    <button
      type="button"
      onClick={() => void dialog.confirm({ title: "Revoke this session?" })}
    >
      Revoke
    </button>
  );
};

class AccountSettings {
  dialog = $settingsDialog({ name: "account", title: "Account" });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    group: "Account",
    order: 1,
    lazy: () => Promise.resolve({ default: Profile }),
  });

  sessions = $settingsSection({
    dialog: this.dialog,
    name: "sessions",
    label: "Sessions",
    group: "Security",
    order: 1001,
    lazy: () => Promise.resolve({ default: Sessions }),
  });
}

const mockMobile = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

/**
 * `SettingsDialog`, drawn by `DialogProvider`: the desktop modal and the
 * phone's drill-down.
 */
describe("SettingsDialog", () => {
  let alepha: Alepha | undefined;
  let matchMedia: typeof window.matchMedia;

  beforeAll(() => {
    setupJsdomMocks();
    matchMedia = window.matchMedia;
  });

  afterEach(async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMedia,
    });
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: { nested?: boolean } = {}) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n);
    alepha.inject(AccountSettings);
    await alepha.start();
    const page = <p>Page</p>;
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          {options.nested ? <DialogProvider>{page}</DialogProvider> : page}
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return alepha.inject(SettingsDialogs);
  };

  const open = (dialogs: SettingsDialogs, section?: string) =>
    act(() => dialogs.open("account", section));

  describe("desktop", () => {
    it("draws nothing until opened", async () => {
      await mount();
      expect(screen.getByText("Page")).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens with a titled, grouped nav of buttons and the section", async () => {
      const dialogs = await mount();
      open(dialogs);
      await waitFor(() =>
        expect(screen.getByText("Profile body")).toBeTruthy(),
      );
      const dialog = screen.getByRole("dialog");
      expect(
        dialog.querySelector("[data-slot=settings-dialog-title]")!.textContent,
      ).toBe("Account");
      expect(screen.getByText("Security")).toBeTruthy();
      const items = dialog.querySelectorAll(
        "[data-slot=settings-dialog-nav-item]",
      );
      expect([...items].map((it) => it.tagName)).toEqual(["BUTTON", "BUTTON"]);
      expect(dialog.querySelector("a")).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "Profile" })
          .getAttribute("aria-current"),
      ).toBe("page");
    });

    it("is drawn once under nested providers", async () => {
      // A preview frame with its own DialogProvider inside the app's layout:
      // only the outermost provider draws the dialog.
      const dialogs = await mount({ nested: true });
      open(dialogs);
      await waitFor(() => screen.getByText("Profile body"));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("switches section from the nav", async () => {
      const dialogs = await mount();
      open(dialogs);
      await waitFor(() => screen.getByText("Profile body"));
      fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy(),
      );
      expect(alepha!.store.get(settingsDialogsAtom)?.section).toBe("sessions");
    });

    it("closes from its X", async () => {
      const dialogs = await mount();
      open(dialogs);
      await waitFor(() => screen.getByText("Profile body"));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(alepha!.store.get(settingsDialogsAtom)?.open).toBeUndefined(),
      );
    });

    it("closes on Escape", async () => {
      const dialogs = await mount();
      open(dialogs);
      await waitFor(() => screen.getByText("Profile body"));
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() =>
        expect(alepha!.store.get(settingsDialogsAtom)?.open).toBeUndefined(),
      );
    });

    it("keeps itself open under a confirm a section opens", async () => {
      const dialogs = await mount();
      open(dialogs, "sessions");
      fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
      await waitFor(() =>
        expect(screen.getByText("Revoke this session?")).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByText("Revoke this session?")).toBeNull(),
      );
      expect(alepha!.store.get(settingsDialogsAtom)?.open).toBe("account");
      expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    });
  });

  describe("phone", () => {
    it("opens bare on the list, slides into a section and back", async () => {
      mockMobile(true);
      const dialogs = await mount();
      open(dialogs);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sessions" })).toBeTruthy(),
      );
      expect(screen.queryByText("Profile body")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Profile" }));
      await waitFor(() => screen.getByText("Profile body"));
      expect(screen.queryByRole("button", { name: "Sessions" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sessions" })).toBeTruthy(),
      );
      expect(screen.queryByText("Profile body")).toBeNull();
      // State, not history: still open, nothing navigated.
      expect(alepha!.store.get(settingsDialogsAtom)?.open).toBe("account");
    });

    it("opens on a named section straight into it", async () => {
      mockMobile(true);
      const dialogs = await mount();
      open(dialogs, "sessions");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy(),
      );
      expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    });
  });
});
