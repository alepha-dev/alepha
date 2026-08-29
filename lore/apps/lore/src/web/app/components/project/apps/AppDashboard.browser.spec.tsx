import { cleanup, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { SigilResource } from "@/api/schemas/sigilResourceSchema.ts";

import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppDashboard from "./AppDashboard.tsx";

/**
 * Records every action the page reaches for.
 *
 * The point of the whole rebuild is that this page costs nothing to open, and
 * "costs nothing" is only checkable by watching what it asks for. Same
 * substitution seam as `QuestDependencyPicker.browser.spec.tsx` (`CLAUDE.md`:
 * never `vi.mock` / `vi.spyOn`).
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async () => {
          this.calls.push(prop);
          return {};
        },
      },
    );
  }
}

const sigilOf = (over: Partial<SigilResource> = {}): SigilResource => ({
  id: "00000000-0000-4000-8000-000000000001",
  projectId: 1,
  name: "docs-production",
  tokenPrefix: "sg_lore_ab",
  kinds: ["beacon", "vitals", "blights", "feedback"],
  createdAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

describe("AppDashboard", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    // The dictionaries are lazy chunks on a service, so nothing loads them
    // until something injects it.
    alepha.inject(I18n);
    await alepha.start();
    return alepha;
  };

  const show = async (sigil: SigilResource) => {
    // Testing Library binds its queries to `document.body`, so a second render
    // in one test would search the first one's DOM as well. Several cases here
    // deliberately render twice to compare two states.
    cleanup();
    const alepha = await mount();
    alepha.store.set(currentSigilAtom, sigil as never);
    return {
      links: alepha.inject(LinkProvider) as RecordingLinkProvider,
      dateTime: alepha.inject(DateTimeProvider),
      ...render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboard />
        </AlephaContext.Provider>,
      ),
    };
  };

  /**
   * The property the rebuild exists for. This page used to render three
   * counters out of an insights payload, so opening the front page of an app
   * cost ten aggregate queries against Analytics Engine.
   */
  it("asks the server for nothing at all", async ({ expect }) => {
    const { links, getByTestId } = await show(sigilOf());

    expect(getByTestId("app-identity")).toBeTruthy();
    expect(links.calls).toEqual([]);
  });

  /**
   * Absent is not off. An older client reports no config, and an app that has
   * never reported has told us nothing either, and rendering both as "off" would
   * accuse an app of collecting nothing on no evidence.
   */
  it("reads an unreported config as unknown, never as off", async ({
    expect,
  }) => {
    const { getAllByText, getByTestId } = await show(sigilOf());

    const capabilities = getByTestId("app-capabilities");
    // One per capability row, on the "app sends" side only.
    expect(getAllByText("Unknown")).toHaveLength(4);
    expect(capabilities.textContent).toContain(
      "This app has not reported its configuration",
    );
  });

  /**
   * The comparison this card exists to make. It was invisible in both
   * directions: the app's own switches lived in its deploy and Lore's lived on
   * a settings page, and nothing ever put them on one screen.
   */
  it("marks a capability the app sends and Lore refuses", async ({
    expect,
  }) => {
    const { getByTestId, getAllByLabelText } = await show(
      sigilOf({
        // Lore accepts views only.
        kinds: ["beacon"],
        // The app says it sends everything.
        reportedConfig: {
          trackers: { views: true, errors: true, vitals: true },
          feedback: true,
          feedbackButton: "bottom-right",
          feedbackButtonExcludedPaths: [],
          reportOutsideProduction: false,
        },
        reportedConfigAt: "2026-08-28T09:00:00.000Z",
      }),
    );

    expect(getByTestId("app-capabilities").textContent).toContain(
      "Reported by the app on",
    );
    // Three rows disagree: errors, vitals and feedback are all sent and all
    // refused. Views is the one that agrees, and carries no marker.
    expect(
      getAllByLabelText("The app and Lore disagree about this one"),
    ).toHaveLength(3);
  });

  it("agrees quietly when both sides say the same thing", async ({
    expect,
  }) => {
    const { queryByLabelText } = await show(
      sigilOf({
        kinds: ["beacon"],
        reportedConfig: {
          trackers: { views: true, errors: false, vitals: false },
          feedback: false,
          feedbackButton: "hidden",
          feedbackButtonExcludedPaths: [],
          reportOutsideProduction: false,
        },
        reportedConfigAt: "2026-08-28T09:00:00.000Z",
      }),
    );

    expect(
      queryByLabelText("The app and Lore disagree about this one"),
    ).toBeNull();
  });

  it("badges an app that has said nothing for a day", async ({ expect }) => {
    const stale = await show(
      sigilOf({ lastSeenAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect(stale.getByText("Silent")).toBeTruthy();

    // From the container's own clock rather than the wall clock, so the
    // assertion cannot drift under `travel()` or a pinned test time.
    const recent = await show(
      sigilOf({
        lastSeenAt: new Date(stale.dateTime.nowMillis() - 60_000).toISOString(),
      }),
    );
    expect(recent.queryByText("Silent")).toBeNull();
  });

  it("says the address is not known rather than inventing one", async ({
    expect,
  }) => {
    const unknown = await show(sigilOf());
    expect(unknown.getByText("Not known yet")).toBeTruthy();

    const detected = await show(sigilOf({ lastSeenHost: "docs.alepha.dev" }));
    expect(detected.getByText("docs.alepha.dev")).toBeTruthy();

    // The operator's pin wins over the detected host, silently.
    const pinned = await show(
      sigilOf({
        lastSeenHost: "docs.alepha.dev",
        url: "https://alepha.dev/docs",
      }),
    );
    expect(pinned.getByText("alepha.dev/docs")).toBeTruthy();
  });
});
