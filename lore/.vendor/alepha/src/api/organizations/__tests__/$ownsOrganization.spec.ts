import { Alepha, z } from "alepha";
import { AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { $entity, $repository, db } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $action, ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiOrganizations,
  $ownsOrganization,
  OrganizationService,
} from "../index.ts";

const organizationContainers = $entity({
  name: "organization_gate_containers",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    organizationId: z.uuid().optional(),
  }),
});

class OrganizationGateApp {
  public readonly containers = $repository(organizationContainers);

  public readonly readOrganization = $action({
    use: [$ownsOrganization({ param: "organizationId" })],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.uuid(),
    },
    handler: ({ params }) => params.organizationId,
  });

  public readonly readOrganizationContainer = $action({
    use: [
      $ownsOrganization({
        repository: () => this.containers,
        param: "id",
        key: "organizationId",
      }),
    ],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.uuid(),
    },
    handler: ({ params }) => params.id,
  });
}

describe("$ownsOrganization", () => {
  it("supports direct and container gates and denies a null container key", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with(AlephaOrmPostgres)
      .with(AlephaApiUsers)
      .with(AlephaApiOrganizations)
      .with(OrganizationGateApp);
    await alepha.start();
    const user = await alepha
      .inject(RealmProvider)
      .userRepository()
      .create({ username: "organization-gate" });
    const organization = await alepha
      .inject(OrganizationService)
      .create({ name: "Gate" }, { id: user.id });
    const app = alepha.inject(OrganizationGateApp);
    const container = await app.containers.create({
      organizationId: organization.id,
    });
    const orphan = await app.containers.create({});
    const token = { id: user.id, roles: [] };

    await expect(
      app.readOrganization.run(
        { params: { organizationId: organization.id } },
        { user: token },
      ),
    ).resolves.toBe(organization.id);
    await expect(
      app.readOrganizationContainer.run(
        { params: { id: container.id } },
        { user: token },
      ),
    ).resolves.toBe(container.id);
    await expect(
      app.readOrganizationContainer.run(
        { params: { id: orphan.id } },
        { user: token },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
