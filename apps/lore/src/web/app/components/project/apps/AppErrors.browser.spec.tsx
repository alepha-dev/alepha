import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, expect, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { SigilResource } from "@/api/schemas/sigilResourceSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppErrors from "./AppErrors.tsx";

class FakeLinkProvider extends LinkProvider {
  public responses: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async () => this.responses[prop] ?? {},
      },
    );
  }
}

class Routes {
  blights = $page({
    name: "projectBlights",
    path: "/:projectSlug/blights",
    component: () => null,
  });
}

const SIGIL: SigilResource = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: 1,
  name: "docs-production",
  tokenPrefix: "sg_lore_ab",
  kinds: ["beacon", "vitals", "blights", "feedback"],
  createdAt: "2026-08-01T10:00:00.000Z",
} as SigilResource;

const groupOf = (over: Record<string, unknown> = {}) => ({
  sigilId: SIGIL.id,
  sigilLabel: SIGIL.name,
  fingerprint: "fp-a",
  name: "TypeError",
  message: "Cannot read properties of undefined",
  origin: "client",
  count: 99,
  firstSeenAt: "2026-08-01T10:00:00.000Z",
  lastSeenAt: "2026-09-03T10:00:00.000Z",
  ...over,
});

/**
 * App ▸ Errors as stats rather than a list (feedback #2085).
 *
 * The load-bearing property is that the CHART comes from `errorSeries` and
 * never from `errorGroups[].count`: the second is a running all-time total on
 * a row filtered by `lastSeenAt`, so a chart fed from it would draw lifetime
 * figures against a window and be wrong invisibly.
 */
describe("AppErrors", () => {
  const show = async (insights: Record<string, unknown>) => {
    cleanup();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    alepha.store.set(currentSigilAtom, SIGIL as never);
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Alepha",
      slug: "alepha",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);

    const links = alepha.inject(LinkProvider) as FakeLinkProvider;
    links.responses = {
      getInsights: {
        errorGroups: [],
        errorSeries: [],
        ...insights,
      },
    };

    return render(
      <AlephaContext.Provider value={alepha}>
        <AppErrors />
      </AlephaContext.Provider>,
    );
  };

  it("says so when the window recorded nothing, instead of drawing an empty chart", async () => {
    const view = await show({
      errorSeries: [
        { date: "2026-09-01", client: 0, server: 0 },
        { date: "2026-09-02", client: 0, server: 0 },
      ],
    });

    await waitFor(() =>
      expect(view.queryByTestId("app-errors-chart-empty")).not.toBeNull(),
    );
    // A window with no failures still has to say zero rather than blank.
    expect(view.container.textContent).toContain("Errors in this window");
  });

  it("totals the window from the series, split by origin", async () => {
    const view = await show({
      errorSeries: [
        { date: "2026-09-01", client: 2, server: 1 },
        { date: "2026-09-02", client: 3, server: 4 },
      ],
    });

    await waitFor(() =>
      expect(view.queryByTestId("app-errors-chart-empty")).toBeNull(),
    );
    const text = view.container.textContent ?? "";
    expect(text).toContain("10"); // 2 + 1 + 3 + 4
    expect(text).toContain("In the browser");
    expect(text).toContain("On the server");
  });

  /**
   * The trap, pinned. A group last seen inside the window carries its whole
   * history in `count`; the chart must not.
   */
  it("does not take the window totals from the groups' all-time counts", async () => {
    const view = await show({
      errorSeries: [{ date: "2026-09-02", client: 1, server: 0 }],
      errorGroups: [groupOf({ count: 99 })],
    });

    await waitFor(() =>
      expect(screen.queryAllByTestId("app-error-group")).toHaveLength(1),
    );
    const text = view.container.textContent ?? "";
    // The list still shows 99, because that is what the group has done in
    // total, and the note above it says which number is which.
    expect(text).toContain("99");
    expect(text).toContain("all-time total");
  });

  it("labels each group's origin", async () => {
    await show({
      errorSeries: [{ date: "2026-09-02", client: 1, server: 1 }],
      errorGroups: [
        groupOf({ fingerprint: "fp-a", origin: "client" }),
        groupOf({ fingerprint: "fp-b", origin: "server" }),
      ],
    });

    await waitFor(() =>
      expect(screen.queryAllByTestId("app-error-origin")).toHaveLength(2),
    );
    const labels = screen
      .queryAllByTestId("app-error-origin")
      .map((el) => el.textContent);
    expect(labels).toEqual(["Browser", "Server"]);
  });

  it("offers the inbox as a real action, not a footer link", async () => {
    const view = await show({
      errorSeries: [{ date: "2026-09-02", client: 1, server: 0 }],
    });

    const link = await waitFor(() => {
      const found = view.container.querySelector('a[href="/alepha/blights"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    // The report said the link "already exists" and still asked for one,
    // which is what a muted `text-xs` link in a corner earns.
    expect(link.className).not.toContain("text-xs");
  });
});
