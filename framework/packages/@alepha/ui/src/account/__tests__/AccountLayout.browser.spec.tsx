import { render, renderHook, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { $pageAccount } from "../$pageAccount.tsx";
import {
  DialogProvider,
  useDialog,
  useHasDialogProvider,
} from "../../core/useDialog.tsx";
import { uiFr } from "../../i18n/fr/uiFr.ts";
import AccountLayout from "../AccountLayout.tsx";
import { AccountRouter } from "../AccountRouter.tsx";
import {
  type AccountRouterOptions,
  accountRouterOptionsAtom,
} from "../AccountRouterOptions.tsx";

/**
 * The account shell rendered: a root `NavShell` with a floating sidebar
 * derived from the `account` subtree, the counterpart of `AdminLayout`.
 *
 * `AccountRouter.spec.ts` owns the routing contract and never renders; these
 * pin what only a render shows. The sidebar's entries, their group order
 * (personal, then the application, then security) and their language; the
 * options that reach the chrome (`brand`, `hide`, `colorScheme`,
 * `className`, `topbarActions`); and the providers `AppShell` now mounts,
 * which the pages' `useDialog()` needs with nothing from the application.
 */
describe("AccountLayout", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    document.documentElement.className = "";
  });

  class Catalogues {
    en = $dictionary({ lazy: async () => ({ default: {} }) });
    fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
  }

  /**
   * An application page at the conventional order, in its own group, to
   * show where the application's band sorts.
   */
  class AppAccountRouter {
    projects = $pageAccount({
      path: "/projects",
      name: "accountProjects",
      nav: { label: "Projects", group: "Lore", order: 100 },
      component: () => "projects",
    });
  }

  /** Anything under the shell that needs a dialog, as a page would. */
  const NeedsDialog = () => {
    useDialog();
    return <span>dialog-ok</span>;
  };

  const mount = async (
    options: AccountRouterOptions = {},
    lang: "en" | "fr" = "en",
  ) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(AccountRouter);
    alepha.inject(AppAccountRouter);
    alepha.inject(Catalogues);
    alepha.set(accountRouterOptionsAtom, options);
    alepha.store.set("alepha.security.user", {
      id: "u-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    } as never);
    await alepha.start();

    // Every page gates on its backing action; name them so all show.
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: {
        getMyProfile: { path: "/users/me" },
        listMySessions: { path: "/users/me/sessions" },
        listMyIdentities: { path: "/users/me/identities" },
        listApiKeys: { path: "/api-keys" },
        listMyConnections: { path: "/users/me/connections" },
      },
      permissions: [],
    } as any);

    await alepha.inject(I18nProvider).setLang(lang);

    return render(
      <AlephaContext.Provider value={alepha}>
        <AccountLayout />
      </AlephaContext.Provider>,
    );
  };

  /** Sidebar entry and group labels, in document order. */
  const sidebarText = (container: HTMLElement): string[] =>
    Array.from(
      container.querySelectorAll(
        '[data-sidebar="group-label"], [data-sidebar="menu-button"]',
      ),
    ).map((node) => node.textContent?.trim() ?? "");

  it("lists every page in the sidebar: personal, then the application, then security", async () => {
    const { container } = await mount();

    expect(sidebarText(container)).toEqual([
      "Account",
      "Profile",
      "Lore",
      "Projects",
      "Security",
      "Security",
      "Sessions",
      "API keys",
      "Connected apps",
    ]);
  });

  it("drops a hidden page from the sidebar", async () => {
    const { container } = await mount({ hide: ["connections", "keys"] });

    const text = sidebarText(container);
    expect(text).not.toContain("Connected apps");
    expect(text).not.toContain("API keys");
    expect(text).toContain("Sessions");
  });

  it("labels the sidebar in the reader's language", async () => {
    // A custom brand, so the default one's "Compte" subtitle is not counted.
    const { container } = await mount({ brand: <span>brand</span> }, "fr");

    const text = sidebarText(container);
    expect(text).toEqual(
      expect.arrayContaining(["Compte", "Profil", "Sécurité", "Clés d'API"]),
    );
    expect(text).not.toContain("Account");
    expect(text).not.toContain("Security");
  });

  it("brands the sidebar with the signed-in user by default", async () => {
    await mount();

    expect(screen.getByTestId("account-brand-name").textContent).toBe(
      "Ada Lovelace",
    );
  });

  it("takes the application's brand instead", async () => {
    await mount({ brand: <span>my-brand</span> });

    expect(screen.getByText("my-brand")).toBeTruthy();
    expect(screen.queryByTestId("account-brand-name")).toBeNull();
  });

  it("floats the sidebar and bounds the shell to the viewport", async () => {
    const { container } = await mount({ className: "account-fence" });

    const root = container.firstElementChild!;
    expect(root.classList.contains("h-svh")).toBe(true);
    expect(root.classList.contains("account-fence")).toBe(true);
    expect(container.querySelector('[data-variant="floating"]')).not.toBeNull();
  });

  it("mounts the dialog provider the pages need", async () => {
    // `topbarActions` renders inside `AppShell`, where a page does.
    await mount({ topbarActions: <NeedsDialog /> });

    expect(screen.getByText("dialog-ok")).toBeTruthy();
    // The ⌘K trigger survives a replaced cluster.
    expect(screen.getByText("Search…")).toBeTruthy();
  });

  it("colorScheme: false leaves the document's theme class alone", async () => {
    document.documentElement.classList.add("dark");

    await mount({ colorScheme: false });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("useHasDialogProvider", () => {
  it("answers whether a provider is above the caller", () => {
    // `DialogProvider` reads the container, so both renders sit under one.
    const alepha = Alepha.create();
    const bare = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    const provided = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{children}</DialogProvider>
      </AlephaContext.Provider>
    );

    const outside = renderHook(() => useHasDialogProvider(), { wrapper: bare });
    expect(outside.result.current).toBe(false);

    const inside = renderHook(() => useHasDialogProvider(), {
      wrapper: provided,
    });
    expect(inside.result.current).toBe(true);
  });
});
