import { virtualClientFake } from "@lore/core/testing";
import { I18n, currentHostAtom } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import BayAgentHost from "./BayAgentHost.tsx";

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
  }
}

/**
 * The Agent host card's count of running jobs: one limit on a host with one
 * lane (#Q4249), both on a host whose Bay runs the jobs that change no code
 * in a lane of their own (#Q4525).
 */
describe("BayAgentHost", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (limits: Record<string, number>) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentHostAtom, {
      id: "00000000-0000-4000-8000-0000000000aa",
      slug: "box-1",
      type: "bay",
      online: true,
      overdue: false,
      deployAllowed: false,
      jobsAllowed: true,
      agentHost: true,
      agentStatus: "available",
      collectSeries: false,
      statsIntervalSeconds: 1800,
      acceptedRuntimes: ["node"],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      project: { id: 1, title: "Acme", slug: "acme" },
      can: [],
      projects: [],
      ...limits,
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <BayAgentHost canUpdate={false} />
      </AlephaContext.Provider>,
    );
    return screen.getByTestId("bay-agent-running").textContent;
  };

  it("counts the running jobs against one limit on a host with one lane", async ({
    expect,
  }) => {
    expect(await show({ jobsRunning: 2, jobsMaxJobs: 3 })).toBe(
      "2 of 3 jobs running",
    );
  });

  it("names both limits on a host that runs the jobs changing no code in their own lane", async ({
    expect,
  }) => {
    expect(
      await show({ jobsRunning: 4, jobsMaxJobs: 3, jobsMaxReadJobs: 8 }),
    ).toBe("4 jobs running, of 3 that change code and 8 others at once");
  });
});
