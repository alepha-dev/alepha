import { Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { act, renderHook, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../../atoms/userProjectsAtom.ts";
import { useCapabilityOption, useCapabilityToggle } from "./useCapability.ts";

const SAVED_AT = "2026-10-06T08:00:00.000Z";

/**
 * Answers `setCapability` the way the controller does: the whole project
 * resource, with no overview-only field on it.
 */
class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      setCapability: async () => ({
        ...projectFixture({ capabilities: ["work", "knowledge"] }),
        updatedAt: SAVED_AT,
      }),
    });
  }
}

/**
 * A capability write refreshes `userProjectsAtom` from a response that lacks
 * the overview's computed fields (#Q2631). The atom validates on write, so a
 * row missing `lastActivityAt` threw after the server had saved, and the root
 * `ActionErrorToaster` showed it.
 */
describe("useCapability", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  const mount = async <T,>(hook: () => T) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    const project = projectFixture();
    alepha.store.set(currentProjectAtom, project as never);
    alepha.store.set(userProjectsAtom, {
      projects: [
        {
          ...project,
          areaCount: 3,
          openQuestCount: 7,
          owner: true,
          lastActivityAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      totalCount: 1,
      ownedCount: 1,
      maxProjects: 10,
      canCreate: true,
    } as never);
    const wrapper = (props: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        {props.children}
      </AlephaContext.Provider>
    );
    return { alepha, ...renderHook(hook, { wrapper }) };
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  it("toggling a capability updates the overview row with no error toast", async ({
    expect,
  }) => {
    const { alepha, result } = await mount(() => useCapabilityToggle("apps"));

    await act(() => result.current.toggle(false));
    await settle();

    expect(screen.queryByText(/lastActivityAt/)).toBeNull();
    const row = alepha.store.get(userProjectsAtom)?.projects[0];
    expect(row?.lastActivityAt).toBe(SAVED_AT);
    expect(row?.areaCount).toBe(3);
    expect(row?.openQuestCount).toBe(7);
    expect(row?.owner).toBe(true);
    expect(row?.capabilities.map((it) => it.key)).toEqual([
      "work",
      "knowledge",
    ]);
  });

  it("toggling a capability option updates the overview row with no error toast", async ({
    expect,
  }) => {
    const { alepha, result } = await mount(() =>
      useCapabilityOption("work", "agentPrompts"),
    );

    await act(() => result.current.toggle(false));
    await settle();

    expect(screen.queryByText(/lastActivityAt/)).toBeNull();
    expect(alepha.store.get(userProjectsAtom)?.projects[0].lastActivityAt).toBe(
      SAVED_AT,
    );
  });
});
