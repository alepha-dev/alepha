import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";
import { FolioLinkService } from "../src/api/services/FolioLinkService.ts";
import { createFolioWikiLinkResolver } from "../src/web/app/components/folios/folioWikiLinkResolver.ts";
import { rewriteFolioWikiLinks } from "../src/web/app/components/folios/rewriteFolioWikiLinks.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const PROJECT_SLUG = "grammar";

/**
 * What both parsers answer for one token, once the ids of the two worlds
 * are folded onto the per-project numbers a person types.
 */
interface Resolved {
  kind: "folio" | "quest" | "epic" | "feedback" | "release";
  id: number;
}

interface Seed {
  projectId: number;
  folio: { id: string; shortId: number; title: string };
  quest: { id: number; shortId: number; title: string };
  epic: { id: number; number: number; title: string };
  feedback: { id: number; shortId: number; title: string };
  release: { id: number; number: number; title: string; tag: string };
}

/**
 * The two link parsers have to agree, token for token, or the reader sees
 * a live link for an edge the graph does not hold, or the reverse. This
 * spec is the agreement: one table of tokens, resolved on the server
 * through `FolioLinkService` (which persists `folio_links`) and in the
 * browser through `createFolioWikiLinkResolver` (which renders), and the
 * two answers compared.
 *
 * The typed grammar of epic #32 is what it was written for, but the legacy
 * forms are in the table too, since #1803 adds and removes nothing.
 */
describe("the reference grammar is one grammar on both sides", () => {
  let alepha: Alepha;
  let folioLinkService: FolioLinkService;
  let seed: Seed;

  beforeAll(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreApi);
    await alepha.start();

    folioLinkService = alepha.inject(FolioLinkService);
    const fake = alepha.inject(FakeProvider);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake.generate(userDataSchema), roles: ["user"] } },
        { user: adminUser },
      );
    const owner = { id: created.data.id, roles: created.data.roles };

    const project = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Grammar ${Date.now()}` } },
        { user: owner },
      );
    const projectId = project.data.id;

    const folio = await alepha
      .inject(FolioController)
      .create.fetch(
        { body: { projectId, title: "Design Notes", content: "the target" } },
        { user: owner },
      );
    const quest = await alepha.inject(QuestController).createQuest.fetch(
      {
        body: {
          projectId,
          title: "Wire the thing",
          description: "",
          area: "orm",
          priority: "high",
          objectives: [],
          attachments: [],
        },
      },
      { user: owner },
    );
    const epic = await alepha
      .inject(EpicController)
      .createEpic.fetch(
        { params: { projectId }, body: { title: "Ship it", description: "" } },
        { user: owner },
      );

    const feedbackApi = alepha.inject(FeedbackController);
    const submitted = await feedbackApi.submitFeedback.fetch(
      {
        params: { projectId },
        body: { title: "Wrong colour", description: "The button is red." },
      },
      { user: owner },
    );
    const feedbackItem = await feedbackApi.getFeedback.fetch(
      { params: { projectId, feedbackId: submitted.data.id } },
      { user: owner },
    );
    const release = await alepha
      .inject(ReleaseController)
      .createRelease.fetch(
        { params: { projectId }, body: { tag: "0.1.0" } },
        { user: owner },
      );

    seed = {
      projectId,
      folio: {
        id: folio.data.id,
        shortId: folio.data.shortId,
        title: folio.data.title,
      },
      quest: {
        id: quest.data.id,
        shortId: quest.data.shortId,
        title: quest.data.title,
      },
      epic: {
        id: epic.data.id,
        number: epic.data.number,
        title: epic.data.title,
      },
      feedback: {
        id: feedbackItem.data.id,
        shortId: feedbackItem.data.shortId,
        title: feedbackItem.data.title,
      },
      release: {
        id: release.data.id,
        number: release.data.number,
        title: release.data.title,
        tag: release.data.tag ?? "",
      },
    };
  });

  afterAll(async () => {
    await alepha.stop();
  });

  /**
   * The server's answer is a `(targetType, toId)` row; `toId` is the
   * folio's uuid or the quest's or epic's integer id, folded back onto the
   * number a person typed.
   */
  const onServer = async (token: string): Promise<Resolved | undefined> => {
    const tokens = folioLinkService.parseTokens(`[[${token}]]`);
    const rows = await folioLinkService.resolveTokenIds(
      tokens,
      seed.projectId,
      "",
    );
    if (rows.length === 0) return undefined;
    const [{ targetType, toId }] = rows;
    if (targetType === "folio" && toId === seed.folio.id) {
      return { kind: "folio", id: seed.folio.shortId };
    }
    if (targetType === "quest" && toId === String(seed.quest.id)) {
      return { kind: "quest", id: seed.quest.shortId };
    }
    if (targetType === "epic" && toId === String(seed.epic.id)) {
      return { kind: "epic", id: seed.epic.number };
    }
    if (targetType === "feedback" && toId === String(seed.feedback.id)) {
      return { kind: "feedback", id: seed.feedback.shortId };
    }
    if (targetType === "release" && toId === String(seed.release.id)) {
      return { kind: "release", id: seed.release.number };
    }
    throw new Error(`unexpected server answer ${targetType}:${toId}`);
  };

  const browserResolver = () =>
    createFolioWikiLinkResolver({
      projectSlug: PROJECT_SLUG,
      folios: [
        {
          id: seed.folio.id,
          shortId: seed.folio.shortId,
          title: seed.folio.title,
          content: "",
          tags: [],
          summary: "",
          directoryId: null,
          projectId: seed.projectId,
          pinned: false,
          protected: false,
          searchText: "",
        } as never,
      ],
      quests: [{ shortId: seed.quest.shortId, title: seed.quest.title }],
      epics: [{ shortId: seed.epic.number, title: seed.epic.title }],
      feedback: [
        {
          shortId: seed.feedback.shortId,
          title: seed.feedback.title,
          status: "pending",
        },
      ],
      releases: [
        {
          number: seed.release.number,
          title: seed.release.title,
          tag: seed.release.tag,
        },
      ],
    });

  /**
   * The browser's answer is an href. For a folio, quest or epic its last
   * segment is the number; a feedback link carries the number in its query,
   * and a release link carries the tag, folded back onto the number here.
   */
  const inBrowser = (token: string): Resolved | undefined => {
    const target = browserResolver().resolve(token);
    if (!target || target.kind === "broken" || target.kind === "blob") {
      return undefined;
    }
    if (target.kind === "feedback") {
      const match = /feedback=(\d+)$/.exec(target.href);
      return match
        ? { kind: "feedback", id: Number.parseInt(match[1], 10) }
        : undefined;
    }
    if (target.kind === "release") {
      return target.href.endsWith(`/${seed.release.tag}`)
        ? { kind: "release", id: seed.release.number }
        : undefined;
    }
    const tail = target.href.split("/").pop() ?? "";
    return { kind: target.kind, id: Number.parseInt(tail, 10) };
  };

  const cases: Array<{
    label: string;
    token: (s: Seed) => string;
    expected: (s: Seed) => Resolved | undefined;
  }> = [
    {
      label: "#Q<n> is the quest",
      token: (s) => `#Q${s.quest.shortId}`,
      expected: (s) => ({ kind: "quest", id: s.quest.shortId }),
    },
    {
      label: "#q<n> is the same quest, the letter is case-insensitive",
      token: (s) => `#q${s.quest.shortId}`,
      expected: (s) => ({ kind: "quest", id: s.quest.shortId }),
    },
    {
      label: "#E<n> is the epic, by its number",
      token: (s) => `#E${s.epic.number}`,
      expected: (s) => ({ kind: "epic", id: s.epic.number }),
    },
    {
      label: "#F<n> is the folio",
      token: (s) => `#F${s.folio.shortId}`,
      expected: (s) => ({ kind: "folio", id: s.folio.shortId }),
    },
    {
      label: "#f<n> too",
      token: (s) => `#f${s.folio.shortId}`,
      expected: (s) => ({ kind: "folio", id: s.folio.shortId }),
    },
    {
      label: "#P<n> is the feedback item",
      token: (s) => `#P${s.feedback.shortId}`,
      expected: (s) => ({ kind: "feedback", id: s.feedback.shortId }),
    },
    {
      label: "#R<n> is the release, by its number",
      token: (s) => `#R${s.release.number}`,
      expected: (s) => ({ kind: "release", id: s.release.number }),
    },
    {
      label: "#r<n> too",
      token: (s) => `#r${s.release.number}`,
      expected: (s) => ({ kind: "release", id: s.release.number }),
    },
    {
      label: "a typed reference to nothing resolves to nothing",
      token: () => "#Q9999",
      expected: () => undefined,
    },
    {
      label: "a feedback reference to nothing resolves to nothing",
      token: () => "#P9999",
      expected: () => undefined,
    },
    {
      label: "a release reference to nothing resolves to nothing",
      token: () => "#R9999",
      expected: () => undefined,
    },
    {
      label: "a letter no kind claims is not a reference",
      token: (s) => `#X${s.quest.shortId}`,
      expected: () => undefined,
    },
    {
      label: "an anchor on a typed reference is not the grammar",
      token: (s) => `#F${s.folio.shortId}#section`,
      expected: () => undefined,
    },
    {
      label: "legacy: a bare #<n> is still the folio",
      token: (s) => `#${s.folio.shortId}`,
      expected: (s) => ({ kind: "folio", id: s.folio.shortId }),
    },
    {
      label: "legacy: quest:#<n> still resolves",
      token: (s) => `quest:#${s.quest.shortId}`,
      expected: (s) => ({ kind: "quest", id: s.quest.shortId }),
    },
    {
      label: "legacy: epic:#<n> still resolves",
      token: (s) => `epic:#${s.epic.number}`,
      expected: (s) => ({ kind: "epic", id: s.epic.number }),
    },
    {
      label: "legacy: a title still resolves",
      token: (s) => s.folio.title,
      expected: (s) => ({ kind: "folio", id: s.folio.shortId }),
    },
  ];

  it.each(cases)("$label", async (c) => {
    const token = c.token(seed);
    const expected = c.expected(seed);
    expect(await onServer(token), `server: [[${token}]]`).toEqual(expected);
    expect(inBrowser(token), `browser: [[${token}]]`).toEqual(expected);
  });

  it("neither side reads a token inside a fence or a code span", async () => {
    const content = [
      "```",
      `[[#Q${seed.quest.shortId}]]`,
      "```",
      `and \`[[#E${seed.epic.number}]]\` inline, but [[#F${seed.folio.shortId}]] in prose.`,
    ].join("\n");

    // Server: one edge, the folio in prose. Before #1803 this returned three,
    // and the design folio of epic #32 carried the proof in production.
    const tokens = folioLinkService.parseTokens(content);
    const rows = await folioLinkService.resolveTokenIds(
      tokens,
      seed.projectId,
      "",
    );
    expect(rows).toEqual([{ targetType: "folio", toId: seed.folio.id }]);

    // Browser: the two code tokens survive verbatim, the prose one is a link.
    const rendered = rewriteFolioWikiLinks(
      content,
      PROJECT_SLUG,
      [
        {
          id: seed.folio.id,
          shortId: seed.folio.shortId,
          title: seed.folio.title,
          content: "",
          tags: [],
          summary: "",
          directoryId: null,
          projectId: seed.projectId,
          pinned: false,
          protected: false,
          searchText: "",
        } as never,
      ],
      [{ shortId: seed.quest.shortId, title: seed.quest.title }],
      [],
      [],
      [{ shortId: seed.epic.number, title: seed.epic.title }],
    );
    expect(rendered).toContain(`[[#Q${seed.quest.shortId}]]`);
    expect(rendered).toContain(`\`[[#E${seed.epic.number}]]\``);
    expect(rendered).toContain(
      `[${seed.folio.title}](/${PROJECT_SLUG}/folios/${seed.folio.shortId})`,
    );
  });
});
