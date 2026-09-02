import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { describe, expect, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";

import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsMembersSection from "./ProjectSettingsMembersSection.tsx";

/**
 * The owner removes a member from a row menu (#1695), and the endpoint's two
 * refusals are mirrored in what the UI offers: only the owner sees a menu,
 * and never on their own row.
 *
 * The mirroring is the point. Showing the action to somebody the server will
 * refuse promises a 403; showing it on the owner's own row promises a project
 * with nobody who can delete it, rename it, or let anybody back in.
 */
const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";

class Routes {
  settings = $page({
    name: "projectSettingsMembers",
    path: "/settings/members",
    component: () => null,
  });
}

class Links extends LinkProvider {
  removed: Array<{ id: number; userId: string }> = [];

  override client(): any {
    const action: any = async (input: any) => {
      this.removed.push(input.params);
      return { ok: true };
    };
    action.can = () => true;
    return new Proxy({} as Record<string, unknown>, { get: () => action });
  }
}

const project = {
  id: 1,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  title: "Alepha",
  slug: "alepha",
  createdBy: OWNER,
  areas: [],
  features: defaultProjectFeatures,
  kanbanColumns: ["In Progress"],
  unlockedFeatures: [],
  unlockHistory: [],
} as never;

const member = (id: string, username: string) => ({
  id: `m-${id}`,
  userId: id,
  projectId: 1,
  owner: id === OWNER,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  user: { id, username, email: `${username}@example.com` },
});

describe("ProjectSettingsMembersSection", () => {
  const mount = async (viewer: string) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentUserAtom, { id: viewer, roles: ["user"] });

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectSettingsMembersSection
            project={project}
            members={[member(OWNER, "owner"), member(MEMBER, "kim")] as never}
            pendingInvitations={[]}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { view, links: alepha.inject(Links) };
  };

  it("offers a row menu on a member, to the owner", async () => {
    const { view } = await mount(OWNER);

    const menus = view.getAllByTestId("member-actions");
    // One, not two: the owner's own row has none.
    expect(menus.length).toBe(1);
    expect(menus[0].getAttribute("aria-label")).toContain("kim");
  });

  it("offers none to a member looking at the same page", async () => {
    const { view } = await mount(MEMBER);

    expect(view.queryAllByTestId("member-actions").length).toBe(0);
  });

  it("removes through the endpoint once the confirmation is accepted", async () => {
    const { view, links } = await mount(OWNER);

    fireEvent.click(view.getByTestId("member-actions"));
    fireEvent.click(await view.findByTestId("remove-member"));

    // The confirmation is part of the action, not part of the layout, so it
    // is what stands between the click and the call.
    const confirm = await view.findByRole("button", { name: /^Remove$/ });
    expect(links.removed).toEqual([]);

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(links.removed).toEqual([{ id: 1, userId: MEMBER }]),
    );
  });

  it("calls nothing when the owner backs out", async () => {
    const { view, links } = await mount(OWNER);

    fireEvent.click(view.getByTestId("member-actions"));
    fireEvent.click(await view.findByTestId("remove-member"));
    fireEvent.click(await view.findByRole("button", { name: /Keep them/ }));

    await waitFor(() => expect(links.removed).toEqual([]));
  });
});
