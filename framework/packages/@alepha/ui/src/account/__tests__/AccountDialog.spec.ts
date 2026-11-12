import { Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";

import { SettingsDialogs } from "../../settings/SettingsDialogs.ts";
import { AccountDialog } from "../AccountDialog.ts";
import { accountDialogOptionsAtom } from "../AccountDialogOptions.ts";

const ALL_ACTIONS = {
  getMyProfile: { path: "/users/me" },
  listMyIdentities: { path: "/users/me/identities" },
  listMySessions: { path: "/users/me/sessions" },
  listApiKeys: { path: "/api-keys" },
  listMyConnections: { path: "/users/me/connections" },
};

/**
 * The account area as a settings dialog: five sections, each gated on its
 * action, in the order and groups they always had, and no route.
 */
describe("AccountDialog", () => {
  const mount = async (options?: { hide?: string[] }) => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    if (options) {
      alepha.store.set(accountDialogOptionsAtom, options as never);
    }
    alepha.inject(AccountDialog);
    await alepha.start();
    return { alepha, dialogs: alepha.inject(SettingsDialogs) };
  };

  const visible = (dialogs: SettingsDialogs) =>
    dialogs.visibleSections("account").map((section) => section.name);

  it("declares the account dialog and its five sections, and no route", async () => {
    const { alepha, dialogs } = await mount();
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: ALL_ACTIONS,
    });

    expect(dialogs.dialog("account")?.options.title).toBe("Account");
    expect(visible(dialogs)).toEqual([
      "profile",
      "security",
      "sessions",
      "keys",
      "connections",
    ]);
    expect(alepha.primitives($page)).toEqual([]);
  });

  it("hides the sections whose backing action is absent", async () => {
    const { alepha, dialogs } = await mount();
    // The keys module is the realistic absentee: an application can mount
    // users without ever mounting AlephaApiKeys, and then the section goes.
    const { listApiKeys: _, ...rest } = ALL_ACTIONS;
    alepha.store.set("alepha.server.request.apiLinks", { actions: rest });

    expect(visible(dialogs)).toEqual([
      "profile",
      "security",
      "sessions",
      "connections",
    ]);
  });

  it("offers nothing over an empty registry", async () => {
    const { alepha, dialogs } = await mount();
    alepha.store.set("alepha.server.request.apiLinks", { actions: {} });
    expect(visible(dialogs)).toEqual([]);
  });

  /**
   * `hide`, for the section `can` cannot answer for: `listMyConnections`
   * ships with `$realm`, so without it every application offers Connected
   * apps.
   */
  describe("hide", () => {
    it("drops a named section while every action is mounted", async () => {
      const { alepha, dialogs } = await mount({ hide: ["connections"] });
      alepha.store.set("alepha.server.request.apiLinks", {
        actions: ALL_ACTIONS,
      });
      expect(visible(dialogs)).toEqual([
        "profile",
        "security",
        "sessions",
        "keys",
      ]);
    });

    it("is ANDed with the action gate, not instead of it", async () => {
      const { alepha, dialogs } = await mount({
        hide: ["connections", "sessions"],
      });
      const { listApiKeys: _, ...rest } = ALL_ACTIONS;
      alepha.store.set("alepha.server.request.apiLinks", { actions: rest });
      expect(visible(dialogs)).toEqual(["profile", "security"]);
    });
  });

  it("names a catalogue key for the title, every label and every group", async () => {
    const { alepha, dialogs } = await mount();
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: ALL_ACTIONS,
    });
    expect(dialogs.dialog("account")?.options.titleKey).toBe(
      "account.dialog.title",
    );
    for (const section of dialogs.visibleSections("account")) {
      expect(section.options.labelKey).toMatch(/^account\.nav\./);
      expect(section.options.groupKey).toMatch(/^account\.nav\.group\./);
    }
  });

  it("parks Account at 1 and Security at 1000 and up", async () => {
    const { alepha, dialogs } = await mount();
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: ALL_ACTIONS,
    });
    const groups = dialogs.groups("account");
    expect(groups.map((group) => group.group)).toEqual(["Account", "Security"]);
    expect(groups[0].sections.map((section) => section.order)).toEqual([1]);
    expect(groups[1].sections.map((section) => section.order)).toEqual([
      1000, 1001, 1002, 1003,
    ]);
  });

  it("forwards the per-section props of the options atom", async () => {
    const { dialogs } = await mount({
      pages: { security: { deleteWarning: "Your projects go too." } },
    } as never);
    const security = (dialogs as any).sections.find(
      (section: any) => section.name === "security",
    );
    expect(security.options.props()).toEqual({
      deleteWarning: "Your projects go too.",
    });
  });
});
