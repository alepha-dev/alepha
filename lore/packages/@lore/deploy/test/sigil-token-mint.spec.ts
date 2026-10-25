import { sigilKeyProject } from "@alepha/lore/sigil";
import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import { SigilTokenService } from "../src/api/index.ts";

class Probe {
  projects = $repository(projects);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  })
    .with(AlephaOrm)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers)
    .with(LoreDeployApi);
  const probe = alepha.inject(Probe);
  const tokens = alepha.inject(SigilTokenService);
  await alepha.start();
  return { probe, tokens };
};

describe("SigilTokenService.mint", () => {
  it("namespaces the token with the project's slug", async ({ expect }) => {
    const { probe, tokens } = await setup();
    const project = await probe.projects.create({
      title: "Club",
      slug: "club",
      createdBy: "00000000-0000-4000-8000-000000000001",
    } as any);

    const { token } = await tokens.mint(project.id);

    expect(sigilKeyProject(token)).toBe("club");
  });

  it("refuses a project without a slug rather than mint the bare shape", async ({
    expect,
  }) => {
    const { probe, tokens } = await setup();
    const project = await probe.projects.create({
      title: "Deleted",
      createdBy: "00000000-0000-4000-8000-000000000001",
    } as any);

    await expect(tokens.mint(project.id)).rejects.toThrow("has no slug");
    await expect(tokens.mint(9999)).rejects.toThrow("has no slug");
  });
});
