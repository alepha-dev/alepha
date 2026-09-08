import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsDefaultEnv from "./ProjectSettingsDefaultEnv.tsx";

/**
 * The permission set the layout loader put in the atom, and the sidebar's
 * only source of truth for what the viewer may see.
 */
const PERMISSIONS = ["project:read", "project:update", "quest:read"];

/**
 * ⚠️ **What the SERVER actually answers**, which is the whole bug:
 * `updateProjectById` returns `projectResourceSchema`, and that schema
 * carries no `permissions` - it is also the shape of `getMyProjects`, of
 * `getHomeOverview` and of the Kanban payload, so an effective set there
 * would have to be computed per project in a list.
 */
const UPDATE_RESPONSE = (() => {
  // ⚠️ Cast because `ProjectResource` does not DECLARE the two fields being
  // dropped here - which is the bug in one line. The fixture writes them
  // anyway, because the atom's schema extends the resource with them; the
  // response schema never has.
  const { permissions, rank, ...narrow } = projectFixture({ id: 7 }) as Record<
    string,
    unknown
  >;
  void permissions;
  void rank;
  return { ...narrow, defaultEnv: "staging" };
})();

const sent: any[] = [];

class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, prop: string) =>
        Object.assign(
          async (input: any) => {
            if (prop !== "updateProjectById") return {};
            sent.push(input?.body);
            return { ...UPDATE_RESPONSE, ...input?.body };
          },
          { can: () => true },
        ),
    });
  }
}

/**
 * Feedback #P2141: "changing `dev env` remove all items from sidebar.
 * Reloading page fix it."
 *
 * ⚠️ This asserts on the ATOM rather than on a sidebar, and that is the
 * point rather than a shortcut. The sidebar is one reader of
 * `currentProjectAtom.permissions`; `canInProject` answers **false** for an
 * absent set, deliberately, so every permission-gated control anywhere on
 * the page went with it. Pinning the field is pinning all of them, and it
 * fails for a reason a reader can act on.
 */
describe("ProjectSettingsDefaultEnv", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    sent.length = 0;
  });

  const mount = async () => {
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

    alepha.store.set(
      currentProjectAtom,
      projectFixture({ id: 7, permissions: PERMISSIONS }) as never,
    );
    alepha.store.set(currentInstancesAtom, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: 7,
        app: "club",
        env: "production",
        ephemeral: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        projectId: 7,
        app: "club",
        env: "staging",
        ephemeral: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);

    return render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsDefaultEnv />
      </AlephaContext.Provider>,
    );
  };

  it("keeps the viewer's permissions after choosing an environment", async () => {
    const view = await mount();

    fireEvent.click(view.getByLabelText("Default environment"));
    fireEvent.click(await screen.findByText("staging"));

    // The save landed...
    await waitFor(() =>
      expect(alepha!.store.get(currentProjectAtom)?.defaultEnv).toBe("staging"),
    );
    // ...and the effective set is still there. Written straight from the
    // update response, this array is gone and the sidebar empties until the
    // next full page load.
    expect(alepha!.store.get(currentProjectAtom)?.permissions).toEqual(
      PERMISSIONS,
    );
    expect(alepha!.store.get(currentProjectAtom)?.rank?.key).toBe("owner");
  });

  it("clears the default when the chosen environment is pressed again", async () => {
    /*
     * ⚠️ Inherited from `Control`, not chosen here: `deselectable` is
     * `clearable || !required`, so a clearable field deselects on a
     * re-press and there is no flag that keeps the clear ROW while
     * refusing the re-press.
     *
     * Carried rather than fought, because here it writes a state the
     * control already offers explicitly - #Q2002 flagged this shape on
     * fields where `undefined` was not a legal value, and clearing the
     * default environment is a real operation with its own row. What
     * stops it repeating is the save's no-op guard.
     */
    const view = await mount();

    fireEvent.click(view.getByLabelText("Default environment"));
    fireEvent.click(await screen.findByText("staging"));
    await waitFor(() => expect(sent).toHaveLength(1));

    fireEvent.click(view.getByLabelText("Default environment"));
    // The trigger now reads "staging" too, so the ROW has to be named by
    // its role rather than by its text.
    fireEvent.click(await screen.findByRole("option", { name: "staging" }));

    await waitFor(() => expect(sent).toHaveLength(2));
    // `null` and not the string: that is what clears the column.
    expect(sent[1]).toEqual({ defaultEnv: null });
  });

  it("offers a clear row instead of a sentinel value", async () => {
    // `CLEARED = "__none__"` is gone: `Control`'s `clearable` writes
    // `undefined` through an internal sentinel, so no made-up string can
    // reach the request body or be read back out of it.
    const view = await mount();

    fireEvent.click(view.getByLabelText("Default environment"));

    expect(await screen.findByText("No default")).toBeTruthy();
    expect(view.baseElement.innerHTML).not.toContain("__none__");
  });
});
