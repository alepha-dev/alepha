import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { uiFr } from "../../i18n/fr/uiFr.ts";
import { navCrumbsAtom } from "../../shell/navCrumbsAtom.ts";
import AdminLayout from "../AdminLayout.tsx";
import { AdminRouter } from "../AdminRouter.tsx";

/**
 * The shell chrome must follow a language switch with no reload.
 *
 * `AdminRouter.spec.ts` pins that every entry NAMES a catalogue key; this
 * pins that naming one is enough - that the sidebar, the section headings and
 * the brand are resolved inside React rather than frozen at the moment the
 * router's class fields ran. That freeze is the bug: an application in French
 * had a French back office wrapped in an English shell.
 */
describe("admin shell labels follow the language", () => {
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
    // The real catalogue, not a fixture: a key renamed on one side only would
    // otherwise pass here and ship English.
    fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
  }

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(AdminRouter);
    alepha.inject(Catalogues);
    await alepha.start();

    // The registry both gates read: `can` wants the action, `nav.permission`
    // wants the permission. Without it the sidebar is one ungated entry.
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: {
        findUsers: { path: "/users" },
        findSessions: { path: "/sessions" },
        listJobs: { path: "/jobs" },
      },
      permissions: [
        "admin:ui",
        "admin:user:read",
        "admin:session:read",
        "admin:job:read",
      ],
    });

    const i18n = alepha.inject(I18nProvider);
    await i18n.setLang("en");

    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminLayout />
      </AlephaContext.Provider>,
    );
  };

  it("re-labels the sidebar and its section headings on setLang", async () => {
    await mount();

    // English first - the `label` beside each key, which is also what an
    // application spreading no catalogue keeps seeing.
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Identity")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();

    await act(async () => {
      await alepha!.inject(I18nProvider).setLang("fr");
    });

    // No remount, no navigation: the same tree re-rendered.
    expect(screen.getByText("Tableau de bord")).toBeTruthy();
    expect(screen.getByText("Utilisateurs")).toBeTruthy();
    expect(screen.getByText("Identité")).toBeTruthy();
    expect(screen.getByText("Système")).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Identity")).toBeNull();
  });

  /**
   * The breadcrumb trail is the only "title" the shell puts on screen, and it
   * reads the same `navLabel` - including for `userDetail`, which is not a
   * sidebar entry and carries a `nav` purely so its crumb has a key.
   */
  it("re-labels the breadcrumb trail", async () => {
    await mount();

    // Stand the trail up by hand: `render` does not run a navigation, so the
    // layers a real route resolution would leave in the store are not there.
    const pages = alepha!.inject(ReactRouter).pages;
    const state = alepha!.store.get("alepha.react.router.state");
    const layerFor = (name: string) => ({
      name,
      index: 0,
      path: "/",
      element: null,
      route: pages.find((page) => page.name === name),
    });

    await act(async () => {
      alepha!.store.set("alepha.react.router.state", {
        ...state,
        layers: [layerFor("admin"), layerFor("userDetail")],
      } as any);
    });

    // The root's crumb (the sidebar brand reads "Admin Panel" since
    // #Q3570, a key of its own, covered below).
    expect(screen.getAllByText("Admin").length).toBe(1);
    expect(screen.getByText("User")).toBeTruthy();

    await act(async () => {
      await alepha!.inject(I18nProvider).setLang("fr");
    });

    expect(screen.getAllByText("Administration").length).toBe(1);
    expect(screen.getByText("Utilisateur")).toBeTruthy();
  });

  /**
   * A detail page's own crumbs (#Q3571): `Admin > Users > Ada Lovelace`
   * rather than the route chain's `Admin > User`, and only while that route
   * is the open leaf.
   */
  it("puts a detail page's crumbs in place of its own", async () => {
    await mount();

    const pages = alepha!.inject(ReactRouter).pages;
    const state = alepha!.store.get("alepha.react.router.state");
    const layerFor = (name: string) => ({
      name,
      index: 0,
      path: "/",
      element: null,
      route: pages.find((page) => page.name === name),
    });

    await act(async () => {
      alepha!.store.set(navCrumbsAtom, {
        route: "userDetail",
        crumbs: [
          { label: "Users", href: "/admin/users" },
          { label: "Ada Lovelace" },
        ],
      });
      alepha!.store.set("alepha.react.router.state", {
        ...state,
        layers: [layerFor("admin"), layerFor("userDetail")],
      } as any);
    });

    const trail = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(trail.textContent).toContain("Users");
    expect(trail.textContent).toContain("Ada Lovelace");
    expect(trail.textContent).not.toMatch(/User(?!s)/);
    expect(
      Array.from(trail.querySelectorAll("a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toContain("/admin/users");

    // Another leaf keeps its own crumb, whatever the atom still holds.
    await act(async () => {
      alepha!.store.set("alepha.react.router.state", {
        ...state,
        layers: [layerFor("admin"), layerFor("sessions")],
      } as any);
    });
    expect(
      screen.getByRole("navigation", { name: /breadcrumb/i }).textContent,
    ).not.toContain("Ada Lovelace");
  });

  it("re-labels the shell's own chrome", async () => {
    await mount();

    // The brand and the ⌘K affordance, declared in the layout rather than on
    // a route - the other half of "the chrome is English".
    expect(screen.getByText("Admin Panel")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to site" })).toBeTruthy();
    expect(screen.getByText("Search…")).toBeTruthy();

    await act(async () => {
      await alepha!.inject(I18nProvider).setLang("fr");
    });

    expect(screen.getByText("Panneau d'administration")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour au site" })).toBeTruthy();
    expect(screen.getByText("Rechercher…")).toBeTruthy();
  });
});
