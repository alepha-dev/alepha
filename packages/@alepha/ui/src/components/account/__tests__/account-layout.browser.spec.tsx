import { render, renderHook, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { uiFr } from "../../../lib/i18n-fr.ts";
import {
  DialogProvider,
  useDialog,
  useHasDialogProvider,
} from "../../use-dialog/use-dialog.tsx";
import AccountLayout from "../account-layout.tsx";
import { accountRouterOptionsAtom } from "../account-router-options.tsx";
import { AccountRouter } from "../account-router.tsx";

/**
 * The account shell mounted on its own, the way the `saas` preset mounts it.
 *
 * Two things went wrong there and both were invisible to `account-router.spec`,
 * which reads the routing contract and never renders. `account-security` and
 * `account-sessions` call `useDialog()`, and the shell mounted no provider on
 * purpose so an `AppShell` would not end up with two; an application with no
 * `AppShell` had no seam to add one and got a stack trace on both pages. And
 * the rail's headings read "ACCOUNT" and "SECURITY" on a French page, because
 * the rail groups by the raw key while the entries had already resolved the
 * translated label.
 */
describe("AccountLayout mounted standalone", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  class Catalogues {
    en = $dictionary({ lazy: async () => ({ default: {} }) });
    fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
  }

  /** A page-like probe: anything under the shell that needs a dialog. */
  const NeedsDialog = () => {
    useDialog();
    return <span>dialog-ok</span>;
  };

  const mount = async (lang: "en" | "fr") => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(AccountRouter);
    alepha.inject(Catalogues);
    // The `header` slot renders inside the shell, so a probe placed there
    // sees exactly the providers a page would.
    alepha.set(accountRouterOptionsAtom, { header: <NeedsDialog /> });
    await alepha.start();

    // Every page gates on its backing action; name them so both groups show.
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: {
        getMyProfile: { path: "/users/me" },
        updateMyProfile: { path: "/users/me" },
        listMySessions: { path: "/users/me/sessions" },
        changeMyPassword: { path: "/users/me/password" },
        listMyIdentities: { path: "/users/me/identities" },
        getMyMfa: { path: "/users/me/mfa" },
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

  it("supplies a dialog provider when the application mounts none", async () => {
    await mount("en");

    expect(screen.getByText("dialog-ok")).toBeTruthy();
  });

  it("labels the rail's groups in the reader's language", async () => {
    await mount("fr");

    // "Compte" is the group heading alone; "Sécurité" is a heading and the
    // page beneath it, so it appears twice, and the raw keys not at all.
    expect(screen.getByText("Compte")).toBeTruthy();
    expect(screen.getAllByText("Sécurité").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Account")).toBeNull();
    expect(screen.queryByText("Security")).toBeNull();
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
