import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import CodeBlamePage from "./CodeBlamePage.tsx";

/**
 * The blame page (#Q4138): runs of lines headed by their commit and its
 * quests, a link to the blame before a commit under the file's older name,
 * and a pending walk asked again until it is done.
 */
const NEW = "a".repeat(40);
const OLD = "b".repeat(40);
const PARENT = "c".repeat(40);
const calls: unknown[] = [];

class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return virtualClientFake({
      getCodeBlame: async (input: unknown) => {
        calls.push(input);
        return { ...blame, status: "ready" };
      },
    });
  }
}

class Routes {
  project = $page({
    name: "project",
    path: "/:projectSlug",
    component: () => null,
  });
}

const commit = (sha: string, subject: string) => ({
  sha,
  subject,
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authoredAt: 1_700_000_000,
  committedAt: 1_700_000_000,
  parents: [PARENT],
  quests: sha === OLD ? [{ number: 9, title: "Old", status: "completed" }] : [],
});

const blame = {
  revision: { name: "main", kind: "branch" as const, sha: NEW },
  path: "g.ts",
  status: "pending" as const,
  text: "const a = 1;\nconst b = 2;\nconst c = 3;\n",
  ranges: [
    { startLine: 1, endLine: 2, commitSha: OLD, originalPath: "f.ts" },
    { startLine: 3, endLine: 3, commitSha: NEW, originalPath: "g.ts" },
  ],
  commits: [commit(OLD, "old work"), commit(NEW, "new work")],
};

describe("CodeBlamePage", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  it("groups lines by commit, links its quests and the blame before it, and asks again while pending", async ({
    expect,
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ id: 7, slug: "acme" }),
    );
    alepha.store.set(currentCodeRepoAtom, {
      repository: {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: 7,
        slug: "api",
        defaultBranch: "main",
        cloneUrl: "https://lore.test/acme/api.git",
        backend: "local",
        createdAt: "2026-11-23T00:00:00.000Z",
      },
      branches: [{ name: "main", sha: NEW }],
      tags: [],
      indexing: false,
    });
    render(
      <AlephaContext.Provider value={alepha}>
        <CodeBlamePage blame={blame} />
      </AlephaContext.Provider>,
    );

    const runs = screen.getAllByTestId("code-blame-run");
    expect(runs).toHaveLength(2);
    expect(runs[0]?.textContent).toContain("old work");
    expect(screen.getByText("#Q9").closest("a")?.getAttribute("href")).toBe(
      "/acme/quests/9",
    );
    expect(
      screen
        .getAllByLabelText("Blame before this commit")[0]
        ?.getAttribute("href"),
    ).toBe(`/acme/code/api/blame/${PARENT}/f.ts`);
    expect(screen.getByTestId("code-blame-pending")).toBeTruthy();

    // The walk finishes: the page asks again, then stops saying pending.
    await screen.findByText("new work");
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    await expect
      .poll(() => screen.queryByTestId("code-blame-pending"))
      .toBeNull();
  });
});
