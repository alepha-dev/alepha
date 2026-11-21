import { Alepha, AlephaError } from "alepha";
import { AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "alepha/orm";
import { describe, it } from "vitest";

import {
  AlephaApiOrganizations,
  InvitationService,
  organizationInvitations,
  OrganizationService,
} from "../index.ts";

/**
 * SQLite that refuses a statement binding more than 100 values, which is
 * what Cloudflare D1 does (`too many SQL variables`). Every other spec of
 * this module runs on drivers that bind tens of thousands.
 */
class D1CeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 100;

  protected override initDrizzle(): void {
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new AlephaError(`too many SQL variables (${bound})`);
      }
      return prepare(text);
    };
    super.initDrizzle();
  }
}

class InvitationRepositories {
  public readonly invitations = $repository(organizationInvitations);
}

describe("alepha/api/organizations - InvitationService on D1", () => {
  it("expires more pending invitations than one statement binds", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: DatabaseProvider, use: D1CeilingProvider })
      .with(AlephaApiUsers)
      .with(AlephaApiOrganizations)
      .with(InvitationRepositories);
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    await alepha.start();
    const owner = await alepha
      .inject(RealmProvider)
      .userRepository()
      .create({ username: "d1-owner", email: "owner@example.com" });
    const organization = await alepha
      .inject(OrganizationService)
      .create({ name: "Acme" }, { id: owner.id });
    const time = alepha.inject(DateTimeProvider);
    const repository = alepha.inject(InvitationRepositories).invitations;
    const past = time.now().subtract(1, "hour").toISOString();
    for (let i = 0; i < 230; i++) {
      await repository.create({
        organizationId: organization.id,
        invitedBy: owner.id,
        email: `invitee-${i}@example.com`,
        status: "pending",
        expiresAt: past,
      });
    }
    const expired: string[] = [];
    alepha.events.on("organization:invitation:expired", ({ invitation }) => {
      expired.push(invitation.id);
    });

    const count = await alepha.inject(InvitationService).expirePending();

    expect(count).toBe(230);
    expect(new Set(expired).size).toBe(230);
    expect(await repository.count({ status: { eq: "pending" } })).toBe(0);
    expect(await repository.count({ status: { eq: "expired" } })).toBe(230);
  });
});
