import { Alepha } from "alepha";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import { MemberController } from "../controllers/MemberController.ts";

/**
 * #Q2506: `POST /organizations/:id/members` and
 * `PUT /organizations/:id/members/:userId/rank` were gated on
 * `member:manage` alone, so a rank holding it could promote itself and add
 * any user past the member cap. They are removed, not guarded: a rank
 * changes through `RankService.assign`, a member joins through an invitation.
 */
describe("alepha/api/organizations - MemberController", () => {
  it("exposes no route that adds a member or sets a rank", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.inject(MemberController);

    const routes = alepha
      .primitives($action)
      .map((action) => `${action.method} ${action.path}`);

    expect(routes).not.toContain("POST /organizations/:organizationId/members");
    expect(
      routes.some((route) => route.endsWith("/members/:userId/rank")),
    ).toBe(false);
    expect(routes).toContain(
      "DELETE /organizations/:organizationId/members/:userId",
    );
  });
});
