import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { AppInstanceResource } from "../src/api/schemas/appInstanceResourceSchema.ts";
import type { InstanceLiveQuests } from "../src/api/schemas/instanceLiveQuestsSchema.ts";
import AppDashboardLiveQuests from "../src/web/app/components/project/apps/AppDashboardLiveQuests.tsx";

/**
 * The Overview's Quests card (#E154): the done quests a copy does not run
 * yet, linked, and a reason instead of a count when its set is unknown.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/:projectSlug/quests/:shortId",
    component: () => null,
  });
}

class FakeLinkProvider extends LinkProvider {
  answer?: InstanceLiveQuests;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async () =>
            name === "getInstanceLiveQuests" ? this.answer : undefined,
          { can: () => true },
        ),
    });
  }
}

const instance = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: 1,
  app: "acme",
  env: "production",
} as AppInstanceResource;

const boot = async (answer: InstanceLiveQuests) => {
  // The substitution first: the router resolves the link provider.
  const alepha = Alepha.create()
    .with({ provide: LinkProvider, use: FakeLinkProvider })
    .with(AlephaReact)
    .with(AlephaReactI18n)
    .with(AlephaReactRouter)
    .with(I18n);
  alepha.inject(Routes);
  await alepha.start();
  await alepha.inject(I18nProvider).setLang("en");
  alepha.inject(FakeLinkProvider).answer = answer;
  alepha.store.set(
    currentProjectAtom,
    projectFixture({ slug: "acme", capabilities: ["ship"] }),
  );
  return alepha;
};

describe("the Overview's Quests card", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(cleanup);

  it("counts the done quests not deployed and links each one", async ({
    expect,
  }) => {
    const alepha = await boot({
      state: "known",
      live: [1, 2],
      behind: [7, 9],
      runs: [],
    });
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardLiveQuests instance={instance} />
        </AlephaContext.Provider>,
      );

      expect((await view.findByTestId("app-live-behind")).textContent).toBe(
        "2 done quests not deployed",
      );
      expect(view.getByRole("link", { name: "#Q7" }).getAttribute("href")).toBe(
        "/acme/quests/7",
      );
      expect(view.getByText("Runs 2 quests")).toBeTruthy();
    } finally {
      await alepha.stop();
    }
  });

  it("says why, never a count, when the set is partial", async ({ expect }) => {
    const alepha = await boot({
      state: "partial",
      reason: "partial",
      live: [1],
      runs: [],
    });
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardLiveQuests instance={instance} />
        </AlephaContext.Provider>,
      );

      expect((await view.findByTestId("app-live-unknown")).textContent).toMatch(
        /shallow clone/,
      );
      expect(view.queryByTestId("app-live-behind")).toBeNull();
    } finally {
      await alepha.stop();
    }
  });

  it("draws nothing for a copy that never deployed", async ({ expect }) => {
    const alepha = await boot({
      state: "unknown",
      reason: "never-deployed",
      runs: [],
    });
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardLiveQuests instance={instance} />
        </AlephaContext.Provider>,
      );
      // Give the query its turn before asserting the absence.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(view.queryByTestId("app-live-quests")).toBeNull();
    } finally {
      await alepha.stop();
    }
  });
});
