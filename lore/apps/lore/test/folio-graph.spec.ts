import { ProjectController } from "@lore/core/api";
import { DirectoryController, FolioController } from "@lore/remember/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The folio graph's read (#Q4262): every folio of the project as a node,
 * every folio-to-folio wiki link as one edge, and nothing else.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

describe("folioGraph", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    bootLore(alepha);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("answers the folios as nodes and their wiki links as edges", async () => {
    const fake = alepha.inject(FakeProvider);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake.generate(userDataSchema), roles: ["user"] } },
        { user: adminUser },
      );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = await alepha.inject(ProjectController).createProject.fetch(
      {
        body: {
          title: "Graph",
          capabilities: [{ key: "plan" }, { key: "remember" }],
        },
      },
      { user },
    );
    const projectId = project.data.id;
    const folios = alepha.inject(FolioController);
    const make = async (title: string, content: string) =>
      (
        await folios.create.fetch(
          { body: { projectId, title, content } },
          { user },
        )
      ).data;

    const hub = await make("Hub", "The centre.");
    const spoke = await make(
      "Spoke",
      // Twice the same target, and itself: one edge.
      `See [[#F${hub.shortId}]] and [[#F${hub.shortId}]], not [[#F2]].`,
    );
    const lone = await make("Lone", "No links, and [[#Q999]] is no folio.");

    const graph = await alepha
      .inject(DirectoryController)
      .folioGraph.fetch({ params: { projectId } }, { user });

    expect(graph.data.nodes.map((node) => node.title)).toEqual([
      "Hub",
      "Spoke",
      "Lone",
    ]);
    expect(graph.data.edges).toEqual([{ from: spoke.id, to: hub.id }]);
    expect(graph.data.nodes.some((node) => node.id === lone.id)).toBe(true);
  });
});
