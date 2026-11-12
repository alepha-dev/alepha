import { renderHook } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { AlephaContext } from "alepha/react";
import { $page, ReactRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $settingsDialog } from "../$settingsDialog.ts";
import { $settingsSection } from "../$settingsSection.ts";
import { SettingsDialogs, settingsDialogsAtom } from "../SettingsDialogs.ts";
import { useSettingsDialog } from "../useSettingsDialog.ts";

const section = () => Promise.resolve({ default: () => null });

let allowKeys = true;

class AccountSettings {
  dialog = $settingsDialog({ name: "account", title: "Account" });

  security = $settingsSection({
    dialog: this.dialog,
    name: "security",
    label: "Security",
    group: "Security",
    order: 1000,
    lazy: section,
  });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    group: "Account",
    order: 1,
    lazy: section,
  });

  keys = $settingsSection({
    dialog: this.dialog,
    name: "keys",
    label: "API keys",
    group: "Security",
    order: 1002,
    can: () => allowKeys,
    lazy: section,
  });
}

class AppSettings {
  protected readonly account = $inject(AccountSettings);

  projects = $settingsSection({
    dialog: this.account.dialog,
    name: "projects",
    label: "Projects",
    group: "App",
    order: 100,
    lazy: section,
  });
}

class Pages {
  home = $page({ path: "/", component: () => <div>Home</div> });
  other = $page({ path: "/other", component: () => <div>Other</div> });
  login = $page({
    path: "/login",
    name: "login",
    component: () => <div>Login</div>,
  });
}

const user = { id: "u1", name: "Ada" } as never;

/**
 * The model under a settings dialog: declaration, open state, the last
 * section, and the three ways it closes or opens by itself.
 */
describe("SettingsDialogs", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(async () => {
    allowKeys = true;
    await alepha?.stop();
    alepha = undefined;
  });

  const start = async (...services: Array<typeof AppSettings>) => {
    alepha = Alepha.create().with(AlephaReact).with(Pages);
    alepha.inject(AccountSettings);
    for (const service of services) alepha.inject(service);
    await alepha.start();
    return alepha.inject(SettingsDialogs);
  };

  const push = async (path: `/${string}`) => {
    await act(async () => {
      await alepha!.inject(ReactRouter).push(path);
    });
  };

  const state = () => alepha!.store.get(settingsDialogsAtom);

  describe("declaration", () => {
    it("registers the dialog and its sections, and no route", async () => {
      const dialogs = await start();
      expect(dialogs.dialog("account")?.options.title).toBe("Account");
      expect(dialogs.visibleSections("account").map((it) => it.name)).toEqual([
        "profile",
        "security",
        "keys",
      ]);
      const router = alepha!.inject(ReactRouter);
      expect(router.matches("/account")).toBe(false);
      expect(router.matches("/profile")).toBe(false);
    });

    it("sorts groups by their smallest member, across classes", async () => {
      // A second class adds a section to the same dialog.
      const dialogs = await start(AppSettings);
      expect(dialogs.groups("account").map((g) => g.group)).toEqual([
        "Account",
        "App",
        "Security",
      ]);
    });

    it("hides a section whose can() is false", async () => {
      allowKeys = false;
      const dialogs = await start();
      expect(dialogs.visibleSections("account").map((it) => it.name)).toEqual([
        "profile",
        "security",
      ]);
    });
  });

  describe("open and close", () => {
    it("opens on the first visible section by default", async () => {
      const dialogs = await start();
      dialogs.open("account");
      expect(state()).toMatchObject({ open: "account", section: "profile" });
    });

    it("opens on the asked section, and a hidden one falls back", async () => {
      allowKeys = false;
      const dialogs = await start();
      dialogs.open("account", "security");
      expect(state()?.section).toBe("security");
      dialogs.open("account", "keys");
      expect(state()?.section).toBe("profile");
    });

    it("remembers the last section until reload, and open(section) wins", async () => {
      const dialogs = await start();
      dialogs.open("account", "keys");
      dialogs.close();
      expect(state()?.open).toBeUndefined();
      dialogs.open("account");
      expect(state()?.section).toBe("keys");
      dialogs.open("account", "security");
      expect(state()?.section).toBe("security");
    });

    it("does not open a dialog with no visible section", async () => {
      const dialogs = await start();
      dialogs.open("nothing");
      expect(state()?.open).toBeUndefined();
    });
  });

  describe("closes by itself", () => {
    it("on a route change", async () => {
      const dialogs = await start();
      await push("/");
      dialogs.open("account");
      await push("/other");
      expect(state()?.open).toBeUndefined();
    });

    it("not on a navigation to the same URL", async () => {
      const dialogs = await start();
      dialogs.open("account");
      const url = new URL("http://localhost/a");
      await alepha!.events.emit("react:transition:begin", {
        previous: { url },
        state: { url: new URL(url) },
      } as never);
      expect(state()?.open).toBe("account");
    });

    it("on sign-out", async () => {
      const dialogs = await start();
      alepha!.store.set(currentUserAtom, user);
      dialogs.open("account");
      alepha!.store.set(currentUserAtom, undefined);
      expect(state()?.open).toBeUndefined();
    });
  });

  describe("?<dialogName>=<section>", () => {
    it("opens the dialog on that section and strips the parameter", async () => {
      await start();
      alepha!.store.set(currentUserAtom, user);
      const router = alepha!.inject(ReactRouter);
      await push("/");
      // A client navigation, not a reload: the inbox row case.
      await push("/other?account=keys&tab=1");
      expect(state()).toMatchObject({ open: "account", section: "keys" });
      expect(router.query).toEqual({ tab: "1" });
      expect(window.location.search).toBe("?tab=1");
    });

    it("opens the first visible section for an unknown one", async () => {
      await start();
      alepha!.store.set(currentUserAtom, user);
      await push("/?account=nope");
      expect(state()).toMatchObject({ open: "account", section: "profile" });
    });

    it("sends a signed-out visitor to login, coming back to the dialog", async () => {
      await start();
      const router = alepha!.inject(ReactRouter);
      await push("/?account=sessions");
      expect(state()?.open).toBeUndefined();
      await expect.poll(() => router.pathname).toBe("/login");
      expect(router.query.redirect).toBe("/?account=sessions");
    });
  });

  describe("useSettingsDialog", () => {
    it("opens, reports its section and closes", async () => {
      await start();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AlephaContext.Provider value={alepha!}>
          {children}
        </AlephaContext.Provider>
      );
      const { result } = renderHook(() => useSettingsDialog("account"), {
        wrapper,
      });
      expect(result.current.isOpen).toBe(false);
      expect(result.current.dialog?.options.title).toBe("Account");
      expect(result.current.sections.map((it) => it.name)).toEqual([
        "profile",
        "security",
        "keys",
      ]);
      act(() => result.current.open("security"));
      expect(result.current.isOpen).toBe(true);
      expect(result.current.section).toBe("security");
      act(() => result.current.close());
      expect(result.current.isOpen).toBe(false);
      expect(result.current.section).toBeUndefined();
    });

    it("has no sections for an unknown dialog", async () => {
      await start();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AlephaContext.Provider value={alepha!}>
          {children}
        </AlephaContext.Provider>
      );
      const { result } = renderHook(() => useSettingsDialog("nope"), {
        wrapper,
      });
      expect(result.current.dialog).toBeUndefined();
      expect(result.current.sections).toEqual([]);
    });
  });
});
