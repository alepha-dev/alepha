import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { CommitLink, currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { BuildShell } from "../../../shell/BuildShell.ts";
import CodeCommitPage from "./CodeCommitPage.tsx";
import CodeCommitsPage from "./CodeCommitsPage.tsx";

/**
 * Commits (#Q4136): a history row links its commit and its quests, a
 * commit page says its parents (a merge, which one it is diffed against),
 * and a commit anywhere links into the project's own Lore repository
 * through the hook Build registers on core's `CommitLinkRegistry`.
 */
const SHA = "a".repeat(40);
const PARENT = "b".repeat(40);
const OTHER = "c".repeat(40);
const repos = { repositories: [] as Array<{ slug: string }> };

class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return virtualClientFake({
      listCodeRepositories: async () => repos,
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

describe("code browser: commit pages", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    node: ReactNode,
    project = projectFixture({ id: 7, slug: "acme" }),
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(BuildShell);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, project);
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
      branches: [{ name: "main", sha: SHA }],
      tags: [],
      indexing: false,
    });
    render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
  };

  it("lists commits with their quests, linked", async ({ expect }) => {
    await mount(
      <CodeCommitsPage
        log={{
          revision: { name: "main", kind: "branch", sha: SHA },
          path: "src",
          page: 0,
          more: false,
          indexing: false,
          commits: [
            {
              sha: SHA,
              subject: "feat: the thing #Q12",
              authorName: "Ada",
              authorEmail: "ada@example.com",
              authoredAt: 1_700_000_000,
              committedAt: 1_700_000_000,
              parents: [PARENT],
              quests: [{ number: 12, title: "The thing", status: "completed" }],
            },
          ],
        }}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "feat: the thing #Q12" })
        .getAttribute("href"),
    ).toBe(`/acme/code/api/commit/${SHA}`);
    expect(screen.getByText("#Q12").closest("a")?.getAttribute("href")).toBe(
      "/acme/quests/12",
    );
  });

  it("names a merge's parents and the one its diff is against", async ({
    expect,
  }) => {
    await mount(
      <CodeCommitPage
        commit={{
          sha: SHA,
          parents: [PARENT, OTHER],
          subject: "Merge feat/x",
          body: "",
          author: { name: "Ada", email: "ada@example.com", at: 1_700_000_000 },
          committer: {
            name: "Ada",
            email: "ada@example.com",
            at: 1_700_000_000,
          },
          quests: [],
        }}
        diff={{
          from: PARENT,
          to: SHA,
          files: [],
          total: 0,
          page: 0,
          pageSize: 50,
          partial: false,
        }}
      />,
    );
    const parents = screen.getByTestId("code-commit-parents");
    expect(
      [...parents.querySelectorAll("a")].map((it) => it.textContent),
    ).toEqual(["bbbbbbb", "ccccccc"]);
    expect(parents.textContent).toContain("against bbbbbbb, its first parent");
  });

  it("links a commit into the project's only Lore repository, and not without code:read", async ({
    expect,
  }) => {
    repos.repositories = [{ slug: "api" }];
    await mount(<CommitLink sha={SHA} repo="someone/elsewhere" />);
    expect((await screen.findByRole("link")).getAttribute("href")).toBe(
      `/acme/code/api/commit/${SHA}`,
    );
    cleanup();
    await alepha?.stop();

    await mount(
      <CommitLink sha={SHA} />,
      projectFixture({ id: 7, slug: "acme", permissions: ["project:read"] }),
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
