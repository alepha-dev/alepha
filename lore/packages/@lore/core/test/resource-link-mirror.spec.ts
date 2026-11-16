import { Alepha } from "alepha";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { folioLinks } from "../src/api/entities/folioLinks.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { ResourceLinkService } from "../src/api/services/ResourceLinkService.ts";

/**
 * The mirror relations of Plan's Requirements (#E153, #Q3763): `actor`,
 * `covers` and `source` rows copy an edge whose truth is a table of
 * `@lore/plan-requirements`. Each rewrite replaces exactly its own rows, and
 * leaves mentions and filings alone.
 */
class LinkProbe {
  links = $repository(folioLinks);
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm).with(AlephaServer).with(AlephaSecurity);
  alepha.with(LoreCoreApi);
  const probe = alepha.inject(LinkProbe);
  await alepha.start();
  return { alepha, links: alepha.inject(ResourceLinkService), probe };
};

const rows = async (probe: LinkProbe) =>
  (await probe.links.findMany({}))
    .map(
      (it) =>
        `${it.fromType}:${it.fromId}>${it.relation ?? "-"}>${it.targetType}:${it.toId}`,
    )
    .sort();

describe("ResourceLinkService mirror relations", () => {
  it("rewrites the actors of one use case, and only its own", async ({
    expect,
  }) => {
    const { alepha, links, probe } = await boot();
    try {
      await links.mirrorInbound(
        "actor",
        { kind: "usecase", id: 7 },
        "persona",
        [1, 2],
      );
      await links.mirrorInbound(
        "actor",
        { kind: "usecase", id: 8 },
        "persona",
        [1],
      );
      await links.mirrorInbound(
        "actor",
        { kind: "usecase", id: 7 },
        "persona",
        [2, 3, 3],
      );

      expect(await rows(probe)).toEqual([
        "persona:1>actor>usecase:8",
        "persona:2>actor>usecase:7",
        "persona:3>actor>usecase:7",
      ]);
    } finally {
      await alepha.stop();
    }
  });

  it("keeps a mention beside a mirror row of the same pair", async ({
    expect,
  }) => {
    const { alepha, links, probe } = await boot();
    try {
      await probe.links.create({
        fromType: "epic",
        fromId: "4",
        targetType: "usecase",
        toId: "7",
      });
      await links.mirrorInbound(
        "covers",
        { kind: "usecase", id: 7 },
        "epic",
        [4],
      );
      await links.mirrorInbound(
        "covers",
        { kind: "usecase", id: 7 },
        "epic",
        [],
      );

      expect(await rows(probe)).toEqual(["epic:4>->usecase:7"]);
    } finally {
      await alepha.stop();
    }
  });

  it("rewrites a requirement's source, and drops every mirror onto a deleted target", async ({
    expect,
  }) => {
    const { alepha, links, probe } = await boot();
    try {
      await links.mirrorOutbound(
        "source",
        { kind: "requirement", id: 15 },
        "folio",
        ["a"],
      );
      await links.mirrorOutbound(
        "source",
        { kind: "requirement", id: 15 },
        "folio",
        ["b"],
      );
      await links.mirrorInbound(
        "actor",
        { kind: "usecase", id: 7 },
        "persona",
        [1],
      );
      expect(await rows(probe)).toEqual([
        "persona:1>actor>usecase:7",
        "requirement:15>source>folio:b",
      ]);

      await links.deleteMirrorsTo("usecase", [7]);
      expect(await rows(probe)).toEqual(["requirement:15>source>folio:b"]);
    } finally {
      await alepha.stop();
    }
  });
});
