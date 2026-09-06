import { cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
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

  /**
   * What a named action answers, when a case cares. Everything else answers
   * `{}`, which is what most of them want.
   */
  public responses: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async () => {
          this.calls.push(prop);
          return this.responses[prop] ?? {};
        },
      },
    );
  }
}

/**
 * An instance with a sigil on it, which is the state every case here is about:
 * the Capabilities card only exists once one has been minted.
 *
 * `instanceOf` takes the SIGIL's own overrides, so the cases below read exactly as
 * they did before the instance level existed.
 */
const instanceOf = (
  sigil: Partial<NonNullable<AppInstanceResource["sigil"]>> = {},
  instance: Partial<AppInstanceResource> = {},
): AppInstanceResource => ({
  id: "00000000-0000-4000-8000-000000000010",
  projectId: 1,
  app: "docs",
  env: "production",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  sigilId: "00000000-0000-4000-8000-000000000001",
  sigil: {
    id: "00000000-0000-4000-8000-000000000001",
    tokenPrefix: "sg_lore_ab",
    kinds: ["beacon", "vitals", "blights", "feedback"],
    createdAt: "2026-08-01T10:00:00.000Z",
    ...sigil,
  },
  ...instance,
});

/**
 * The one route the next-steps card links to. Declared here rather than booted
 * from `AppRouter`, which would pull the whole route table and every loader
 * with it.
 */
class Routes {
  appSettings = $page({
    name: "appSettings",
    path: "/:projectSlug/apps/:app/:env/settings",
    component: () => null,
  });
}

describe("AppDashboard", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    // The dictionaries are lazy chunks on a service, so nothing loads them
    // until something injects it.
    alepha.inject(I18n);
    await alepha.start();
    return alepha;
  };

  const show = async (
    instance: AppInstanceResource,
    responses: Record<string, unknown> = {},
  ) => {
    // Testing Library binds its queries to `document.body`, so a second render
    // in one test would search the first one's DOM as well. Several cases here
    // deliberately render twice to compare two states.
    cleanup();
    const alepha = await mount();
    alepha.store.set(currentInstanceAtom, instance as never);
    // The project is part of the page's context in production, so it is set
    // here too; nothing on this page reads it since Artifacts left for its own
    // tab, and a case that starts needing it must not pass by skipping the
    // code it is about.
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Alepha",
      slug: "alepha",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      // Empty until the surfaces read capabilities: this spec is
      // about something else, and a fixture that claims capabilities it
      // does not exercise is a lie the next reader has to check.
      capabilities: [],
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);
    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;
    return {
      links,
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
   *
   * Between epic #18 and feedback #2065 this read "one artifact listing and
   * no analytics query": the Artifacts card issued one indexed read. The card
   * is a tab of its own now (`AppArtifacts.browser.spec.tsx` owns that
   * listing), so the front page is back to asking for nothing. Written as an
   * exact list rather than "no analytics", so any request creeping back in is
   * a red test and a decision.
   */
  it("asks the server for nothing at all", async ({ expect }) => {
    const { links, getByTestId } = await show(instanceOf());

    expect(getByTestId("app-identity")).toBeTruthy();
    // Awaited, so an effect that fires after the first paint is caught too:
    // a synchronous read of an empty array would pass for the wrong reason.
    await waitFor(() => expect(links.calls).toEqual([]));
  });

  /**
   * Absent is not off. An older client reports no config, and an app that has
   * never reported has told us nothing either, and rendering both as "off" would
   * accuse an app of collecting nothing on no evidence.
   */
  it("reads an unreported config as unknown, never as off", async ({
    expect,
  }) => {
    const { getAllByText, getByTestId } = await show(instanceOf());

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
      instanceOf({
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
      instanceOf({
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
      instanceOf({ lastSeenAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect(stale.getByText("Silent")).toBeTruthy();

    // From the container's own clock rather than the wall clock, so the
    // assertion cannot drift under `travel()` or a pinned test time.
    const recent = await show(
      instanceOf({
        lastSeenAt: new Date(stale.dateTime.nowMillis() - 60_000).toISOString(),
      }),
    );
    expect(recent.queryByText("Silent")).toBeNull();
  });

  /**
   * The normal state right after creation, and where you land - so it is the
   * first impression of the whole feature. A card grid with holes in it is
   * what this replaced: both cards read a sigil, so without one the
   * capabilities card has nothing and the identity card's token and
   * last-report rows are blank.
   */
  it("offers next steps for an instance with nothing unlocked", async ({
    expect,
  }) => {
    const { getByTestId, queryByTestId } = await show({
      id: "00000000-0000-4000-8000-000000000011",
      projectId: 1,
      app: "club",
      env: "production",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    } as AppInstanceResource);

    expect(getByTestId("app-next-steps")).toBeTruthy();
    expect(queryByTestId("app-identity")).toBeNull();
    expect(queryByTestId("app-capabilities")).toBeNull();
  });

  /**
   * The whole visible effect of an estate in v3. Present only when one is
   * attached: a row reading "none" would be a control that changes nothing.
   */
  it("names the estate it deploys to, when it has one", async ({ expect }) => {
    const withEstate = await show(
      instanceOf(
        {},
        {
          estateId: "00000000-0000-4000-8000-0000000000e1",
          estate: {
            id: "00000000-0000-4000-8000-0000000000e1",
            slug: "ovh-1",
            type: "bay",
          },
        },
      ),
    );
    expect(withEstate.getByText("Deploys to")).toBeTruthy();
    expect(withEstate.getByText("ovh-1")).toBeTruthy();

    const without = await show(instanceOf());
    expect(without.queryByText("Deploys to")).toBeNull();
  });

  it("says the address is not known rather than inventing one", async ({
    expect,
  }) => {
    const unknown = await show(instanceOf());
    expect(unknown.getByText("Not known yet")).toBeTruthy();

    const detected = await show(
      instanceOf({ lastSeenHost: "docs.alepha.dev" }),
    );
    expect(detected.getByText("docs.alepha.dev")).toBeTruthy();

    // The operator's pin wins over the detected host, silently.
    // The pin lives on the INSTANCE and the detected host on its sigil, which
    // is the split Apps v3 made: an address describes the deployed copy, not
    // the credential.
    const pinned = await show(
      instanceOf(
        { lastSeenHost: "docs.alepha.dev" },
        { url: "https://alepha.dev/docs" },
      ),
    );
    expect(pinned.getByText("alepha.dev/docs")).toBeTruthy();
  });
});
