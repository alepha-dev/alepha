import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { OrganizationMembers } from "../OrganizationMembers.tsx";

const ownerId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const organizationId = "00000000-0000-4000-8000-000000000003";

class Links extends LinkProvider {
  public removed: Array<Record<string, unknown>> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "getOrganizationMembers") {
              return [
                {
                  id: "00000000-0000-4000-8000-000000000011",
                  organizationId,
                  userId: ownerId,
                  rank: "owner",
                  createdAt: "2026-09-01T10:00:00.000Z",
                  updatedAt: "2026-09-01T10:00:00.000Z",
                  user: { id: ownerId, username: "owner" },
                },
                {
                  id: "00000000-0000-4000-8000-000000000012",
                  organizationId,
                  userId: memberId,
                  rank: "member",
                  createdAt: "2026-09-02T10:00:00.000Z",
                  updatedAt: "2026-09-02T10:00:00.000Z",
                  user: { id: memberId, username: "kim" },
                },
              ];
            }
            if (name === "getOrganizationRanks") {
              return {
                items: [
                  { key: "owner", name: "Owner", permissions: [] },
                  { key: "member", name: "Member", permissions: [] },
                ],
              };
            }
            if (name === "removeOrganizationMember") {
              this.removed.push(input.params);
            }
            return { ok: true };
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

describe("OrganizationMembers", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (canManage: boolean) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentUserAtom, { id: ownerId, roles: ["user"] });
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <OrganizationMembers
            organizationId={organizationId}
            can={(permission) => permission === "member:manage" && canManage}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByText("kim");
    return { links: alepha.inject(Links), view };
  };

  it("only renders management controls when can allows member management", async () => {
    const managed = await mount(true);
    expect(managed.view.getAllByTestId("member-actions")).toHaveLength(1);
    managed.view.unmount();

    const readOnly = await mount(false);
    expect(readOnly.view.queryByTestId("member-actions")).toBeNull();
  });

  it("removes a member only after confirmation", async () => {
    const { links, view } = await mount(true);

    fireEvent.click(view.getByTestId("member-actions"));
    fireEvent.click(await view.findByTestId("remove-member"));
    expect(links.removed).toEqual([]);

    fireEvent.click(await view.findByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(links.removed).toEqual([{ organizationId, userId: memberId }]),
    );
  });
});
