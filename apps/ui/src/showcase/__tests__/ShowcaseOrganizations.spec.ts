import { Alepha } from "alepha";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { UiShowcase } from "../index.ts";

const start = async () => {
  const alepha = Alepha.create().with(UiShowcase);
  await alepha.start();
  return alepha.inject(LinkProvider);
};

const REQUIRED = [
  "getMyOrganizations",
  "createOrganization",
  "getOrganizationMembers",
  "removeOrganizationMember",
  "leaveOrganization",
  "transferOrganizationOwnership",
  "getOrganizationInvitations",
  "createOrganizationInvitation",
  "revokeOrganizationInvitation",
  "getMyOrganizationInvitations",
  "acceptOrganizationInvitation",
  "declineOrganizationInvitation",
  "getOrganizationRankCatalogue",
  "getOrganizationRanks",
  "saveOrganizationRank",
  "deleteOrganizationRank",
  "assignOrganizationRank",
] as const;

describe("showcase organization fixtures", () => {
  it("registers every action the organization screens call", async ({
    expect,
  }) => {
    const names = (await start()).getServerLinks().map((link) => link.name);

    for (const action of REQUIRED) {
      expect(names).toContain(action);
    }
  });

  it("returns organizations, members, invitations, and ranks", async ({
    expect,
  }) => {
    const api = (await start()).client() as any;
    const organizations = await api.getMyOrganizations();
    const organizationId = organizations[0].id;

    expect(organizations[0]).toMatchObject({
      name: "Analytical Engines",
      rank: "owner",
    });
    await expect(
      api.getOrganizationMembers({ params: { organizationId } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rank: "owner",
          user: expect.objectContaining({ email: "ada@alepha.dev" }),
        }),
      ]),
    );
    await expect(
      api.getOrganizationInvitations({ params: { organizationId } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: "charles@alepha.dev" }),
      ]),
    );
    await expect(
      api.getOrganizationRanks({ params: { organizationId } }),
    ).resolves.toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ key: "owner" }),
        expect.objectContaining({ key: "member" }),
      ]),
    });
  });
});
