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

import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
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
    // ⚠️ Keyed on the action NAME, not one function for every property. The
    // section reads more than one action now - the rank picker asks
    // `getRanks` on mount - and a fake that recorded every call as a removal
    // failed the "nothing was removed" case for a call about ranks.
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) => {
        const action: any = async (input: any) => {
          if (name === "removeMember") {
            this.removed.push(input.params);
          }
          return name === "getRanks" ? { items: [] } : { ok: true };
        };
        action.can = () => true;
        return action;
      },
    });
  }
}

/**
 * ⚠️ The section reads the viewer's rank off `currentProjectAtom` now, not off
 * a prop: what it offers is `member:manage`, which a custom Admin rank may
 * hold. The prop is still the project's identity.
 */
const projectFor = (viewer: string) =>
  projectFixture({
    title: "Alepha",
    slug: "alepha",
    permissions: viewer === OWNER ? ["*"] : ["project:read", "member:read"],
    rank:
      viewer === OWNER
        ? { key: "owner", name: "Owner" }
        : { key: "member", name: "Member" },
  }) as never;

const member = (id: string, username: string) => ({
  id: `m-${id}`,
  userId: id,
  projectId: 1,
  owner: id === OWNER,
  // The remove menu hides on the OWNER's row, off the rank rather than off
  // `project.createdBy`: after an ownership transfer the two disagree.
  rank: id === OWNER ? "owner" : "member",
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
    alepha.store.set(currentProjectAtom, projectFor(viewer));

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectSettingsMembersSection
            project={projectFor(viewer)}
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
