import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectApps from "./ProjectApps.tsx";

class Routes {
  app = $page({
    name: "app",
    path: "/:projectSlug/apps/:app/:env",
    component: () => null,
  });
}

const aProject = {
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
};

let seq = 0;
const anInstance = (
  app: string,
  env: string,
  over: Partial<AppInstanceResource> = {},
): AppInstanceResource =>
  ({
    id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    projectId: 1,
    app,
    env,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...over,
  }) as AppInstanceResource;

/**
 * Timestamps relative to the wall clock rather than pinned.
 *
 * The component reads `DateTimeProvider.nowMillis()`, and travelling the
 * container's clock to an absolute date is not what `travel` takes. An hour ago
 * and eight days ago are unambiguous on either side of a 24-hour threshold
 * however long the suite takes to run.
 */
const agoHours = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const withSigil = (lastSeenAt?: string) => ({
  sigilId: "00000000-0000-4000-8000-0000000000a1",
  sigil: {
    id: "00000000-0000-4000-8000-0000000000a1",
    tokenPrefix: "sg_test_",
    kinds: ["beacon"],
    createdAt: "2026-08-01T10:00:00.000Z",
    ...(lastSeenAt ? { lastSeenAt } : {}),
  },
});

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({}, { get: () => async () => ({}) });
  }
}

describe("the Apps list", () => {
  const mount = async (
    instances: AppInstanceResource[] | undefined,
    { owner = true }: { owner?: boolean } = {},
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    alepha.inject(Routes);
    await alepha.start();

    alepha.store.set(currentProjectAtom, aProject as never);
    alepha.store.set(currentProjectMemberAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000001",
      projectId: 1,
      owner,
    } as never);
    alepha.store.set(currentInstancesAtom, instances as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectApps />
      </AlephaContext.Provider>,
    );

    return { alepha, view };
  };

  const rowText = (view: { container: HTMLElement }) =>
    [...view.container.querySelectorAll("tbody tr")].map(
      (row) => row.textContent ?? "",
    );

  it("repeats the app name rather than blank-filling it", async ({
    expect,
  }) => {
    // A blank cell breaks sorting on every other column, and sorting is most
    // of what a flat list is for.
    const { view } = await mount([
      anInstance("club", "production"),
      anInstance("club", "b14-production"),
      anInstance("lore", "production"),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    expect(rowText(view).filter((text) => text.includes("club"))).toHaveLength(
      2,
    );
  });

  it("gives a sigil-less instance a hollow dot, never a silent one", async ({
    expect,
  }) => {
    // ⚠️ The case the old `isSilent` got wrong: no sigil means no
    // `lastSeenAt`, ever, so it rendered as silent forever - the UI reporting
    // a fault where there is a configuration.
    const { view } = await mount([
      anInstance("club", "production"),
      anInstance("club", "staging", withSigil(agoHours(1))),
      anInstance("club", "old", withSigil(agoHours(24 * 8))),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    const states = [
      ...view.container.querySelectorAll("[role=img][data-state]"),
    ].map((dot) => dot.getAttribute("data-state"));
    expect(states).toEqual(["none", "reporting", "silent"]);
  });

  it("labels the dot for a reader, not only by colour", async ({ expect }) => {
    // Colour is the only carrier left since Reports and Last seen were cut,
    // and green against amber is the pair deuteranopia hits hardest.
    const { view } = await mount([anInstance("club", "production")]);

    await waitFor(() => expect(rowText(view)).toHaveLength(1));
    const dot = view.container.querySelector("[role=img][data-state]")!;
    expect(dot.getAttribute("aria-label")).toBe("No sigil, nothing reports");
    expect(dot.getAttribute("title")).toBe("No sigil, nothing reports");
  });

  it("filters on the env half as well as the app half", async ({ expect }) => {
    // What makes a tenant-ish substring find anything at all: the app is
    // called `club` and only the env carries `b14`.
    const { view } = await mount([
      anInstance("club", "production"),
      anInstance("club", "b14-production"),
      anInstance("lore", "production"),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    const search = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search"]',
    )!;
    fireEvent.change(search, { target: { value: "b14" } });

    await waitFor(() => expect(rowText(view)).toHaveLength(1));
    expect(rowText(view)[0]).toContain("b14-production");
  });

  it("tells a failed read apart from an empty project", async ({ expect }) => {
    // ⚠️ They must not collapse into one falsy check: an empty state on a
    // transient failure claims a project has no apps. This page owns the
    // failed-read state now the sidebar's entry is gone.
    const failed = await mount(undefined);
    expect(failed.view.container.textContent).toContain("Couldn’t load apps");
    expect(failed.view.container.textContent).not.toContain("No app yet");

    const empty = await mount([]);
    await waitFor(() =>
      expect(empty.view.container.textContent).toContain("No app yet"),
    );
    expect(empty.view.container.textContent).not.toContain("Couldn’t load");
  });

  it("offers the create to an owner and not to a member", async ({
    expect,
  }) => {
    const asOwner = await mount([]);
    await waitFor(() =>
      expect(asOwner.view.container.textContent).toContain("New app"),
    );

    const asMember = await mount([], { owner: false });
    await waitFor(() =>
      expect(asMember.view.container.textContent).toContain("No app yet"),
    );
    expect(asMember.view.container.textContent).not.toContain("New app");
  });
});
