import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { blights } from "../entities/blights.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import { LoreApi } from "../index.ts";
import { SigilIngestService } from "./SigilIngestService.ts";

class Repositories {
  sigils = $repository(sigils);
  blights = $repository(blights);
  groups = $repository(sigilErrorGroups);
}

/**
 * #Q2503: `count` was summed without a bound, in SQL and in the fold. Two
 * reports of `MAX_SAFE_INTEGER` pushed a stored total past the safe-integer
 * range, and every read of the project's blights then threw on the
 * `z.integer()` decode: the list, `blight_list` and the blight page, with no
 * way to delete the row from the UI. The envelope caps one report now, and
 * this is the backstop behind it: the service is handed what the sink's own
 * schema accepted, so it is fed the unbounded value directly.
 */
describe("SigilIngestService - blight counts", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreApi);
    alepha.inject(TestEntityRepositories);
    const repos = alepha.inject(Repositories);
    await alepha.start();

    const project = await createTestProject(alepha);
    const sigil = await repos.sigils.create({
      projectId: project.id,
      name: "count-cap",
      tokenHash: "hash-count-cap",
      tokenPrefix: "sg_test_",
      kinds: ["blights"],
    });

    return {
      ingest: alepha.inject(SigilIngestService),
      repos,
      project,
      sigil,
    };
  };

  const huge = {
    name: "TypeError",
    message: "boom",
    stack: "at poisoned (app.js:1:1)",
    sourceUrl: "https://app.example/",
    count: Number.MAX_SAFE_INTEGER,
  };

  it("keeps the list readable after two MAX_SAFE_INTEGER reports", async ({
    expect,
  }) => {
    const { ingest, repos, project, sigil } = await setup();

    await ingest.absorb(sigil, { errors: [huge] });
    await ingest.absorb(sigil, { errors: [huge] });

    const rows = await repos.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1_000_000_000);

    const groups = await repos.groups.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(groups[0].count).toBe(1_000_000_000);
  });

  it("caps the fold of one envelope too", async ({ expect }) => {
    const { ingest, repos, project, sigil } = await setup();

    await ingest.absorb(sigil, { errors: [huge, huge, huge] });

    const rows = await repos.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(rows[0].count).toBe(1_000_000_000);
  });

  it("still sums ordinary counts", async ({ expect }) => {
    const { ingest, repos, project, sigil } = await setup();

    await ingest.absorb(sigil, { errors: [{ ...huge, count: 3 }] });
    await ingest.absorb(sigil, { errors: [{ ...huge, count: 4 }] });

    const rows = await repos.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(rows[0].count).toBe(7);
  });
});
