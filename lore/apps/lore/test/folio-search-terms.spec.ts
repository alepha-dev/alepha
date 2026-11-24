import { ProjectController } from "@lore/core/api";
import {
  DirectoryController,
  FolioController,
  FolioSearchTerms,
} from "@lore/remember/api";
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
 * A folio search never hands the database a `LIKE` pattern it refuses
 * (#Q4271). D1 caps a pattern at 50 bytes and answered a pasted paragraph
 * with "LIKE or GLOB pattern too complex", a 500. Local SQLite has no such
 * cap, so the helper's half checks every pattern it builds fits, and the
 * scenario half checks a long query and a wildcard query answer right.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

describe("FolioSearchTerms", () => {
  const terms = new FolioSearchTerms();

  it("splits a query into lowercased, deduplicated words", () => {
    expect(terms.terms("  Gate WARD gate ")).toEqual(["gate", "ward"]);
    expect(terms.terms("   ")).toEqual([]);
  });

  it("keeps at most MAX_TERMS words of a pasted paragraph", () => {
    const paragraph = Array.from({ length: 40 }, (_, i) => `word${i}`).join(
      " ",
    );
    expect(terms.terms(paragraph)).toHaveLength(FolioSearchTerms.MAX_TERMS);
  });

  it("cuts every word so its escaped pattern fits D1's 50 bytes", () => {
    const words = [
      "a".repeat(500),
      "%".repeat(100),
      "_\\%".repeat(40),
      "é".repeat(100),
      "😀".repeat(40),
    ];
    for (const term of terms.terms(words.join(" "))) {
      expect(terms.patternBytes(term)).toBeLessThanOrEqual(
        FolioSearchTerms.MAX_PATTERN_BYTES,
      );
      expect(term.length).toBeGreaterThan(0);
    }
    expect(terms.terms("a".repeat(500))[0]).toHaveLength(48);
    expect(terms.terms("%".repeat(100))[0]).toHaveLength(24);
  });
});

describe("Folio search, a long or wildcard query", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        DATABASE_URL: ":memory:",
      },
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

  const seed = async () => {
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
        body: { title: "Search terms", capabilities: [{ key: "remember" }] },
      },
      { user },
    );
    const projectId = project.data.id;
    const folios = alepha.inject(FolioController);
    for (const [title, content] of [
      ["Release notes", "The deploy ships at 100% on the first try."],
      ["Rate card", "The deploy ships at 100 percent, eventually."],
      ["Naming", "Every column is snake_case in the database."],
      ["Spacing", "Every column is snakeXcase in the database."],
    ]) {
      await folios.create.fetch(
        { body: { projectId, title, content } },
        { user },
      );
    }
    return { user, projectId, folios };
  };

  it("answers a pasted paragraph, matching its words", async () => {
    const { user, projectId, folios } = await seed();
    const paragraph = `deploy ships ${"lorem ipsum dolor sit amet ".repeat(40)}`;
    const found = await folios.list.fetch(
      { query: { projectId, q: paragraph } },
      { user },
    );
    // The first eight words are kept: "lorem" and its friends match nothing.
    expect(found.data).toEqual([]);

    const words = await folios.list.fetch(
      { query: { projectId, q: `deploy ${"x".repeat(5000)} ships` } },
      { user },
    );
    expect(words.data).toEqual([]);

    const both = await folios.list.fetch(
      { query: { projectId, q: "SHIPS deploy" } },
      { user },
    );
    expect(both.data.map((f) => f.title).sort()).toEqual([
      "Rate card",
      "Release notes",
    ]);
  });

  it("matches % and _ literally", async () => {
    const { user, projectId, folios } = await seed();
    const percent = await folios.list.fetch(
      { query: { projectId, q: "100%" } },
      { user },
    );
    expect(percent.data.map((f) => f.title)).toEqual(["Release notes"]);

    const underscore = await folios.list.fetch(
      { query: { projectId, q: "snake_case" } },
      { user },
    );
    expect(underscore.data.map((f) => f.title)).toEqual(["Naming"]);

    const search = await alepha
      .inject(DirectoryController)
      .searchFolio.fetch(
        { params: { projectId }, query: { q: "snake_case" } },
        { user },
      );
    expect(search.data.entries.map((e) => e.name)).toEqual(["Naming"]);
  });
});
