import { ProjectController, ReportsDigest } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The weekly digest's source (#Q3018): Summary's lines, as text a notification
 * can carry.
 */
describe("ReportsDigest", () => {
  it("reads the enabled capabilities' last seven days into one digest", async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(AlephaMcp);
    bootLore(alepha, ["api", "mcp"]);

    const digest = alepha.inject(ReportsDigest);
    const projectApi = alepha.inject(ProjectController);
    const users = alepha.inject(UserService);
    await alepha.start();

    const owner = await users.createUser({ username: "owner" });
    const project = await alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: owner.id,
        roles: ["user"],
      });
      return projectApi.createProject({
        body: { title: "Digest", capabilities: [{ key: "work" }] },
      });
    });

    const page = await digest.read(
      project.id,
      alepha.inject(DateTimeProvider).nowISOString(),
    );

    expect(page.items.map((item) => item.key)).toContain("throughput");
    expect(page.items.map((item) => item.key)).not.toContain("deploys");
    const text = digest.text({
      ...page,
      items: page.items as never,
      selected: page.items.length,
      shown: page.items.length,
      truncated: false,
      values: {},
    } as never);
    expect(text).toContain("Quests completed: 0");

    await alepha.stop();
  });
});
