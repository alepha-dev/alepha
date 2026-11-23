import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import CodeBlobPage from "./CodeBlobPage.tsx";
import CodeTreePage from "./CodeTreePage.tsx";

/**
 * The tree and the file pages (#Q4134), on a branch whose name holds a
 * slash: every link keeps `feat/x` whole, a README's relative link opens the
 * file at the same revision and its image reads the raw bytes at the commit,
 * a file is numbered and highlighted, and its lines select from the URL.
 */
const SHA = "a".repeat(40);
const revision = { name: "feat/x", kind: "branch" as const, sha: SHA };

const treeCommits = {
  calls: [] as unknown[],
  answer: {
    indexing: false,
    entries: [
      {
        name: "src",
        commit: {
          sha: "b".repeat(40),
          subject: "touch src",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authoredAt: 1_700_000_000,
          committedAt: 1_700_000_000,
          parents: [],
        },
      },
    ],
  },
};

class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return virtualClientFake({
      getCodeTreeCommits: async (input: unknown) => {
        treeCommits.calls.push(input);
        return treeCommits.answer;
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

describe("code browser pages", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (node: ReactNode) => {
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
      branches: [
        { name: "feat/x", sha: SHA },
        { name: "main", sha: "c".repeat(40) },
      ],
      tags: [],
      indexing: false,
    });
    render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
  };

  it("links a tree's entries and its README at the branch, slash and all", async ({
    expect,
  }) => {
    await mount(
      <CodeTreePage
        tree={{
          revision,
          path: "",
          entries: [
            { name: "src", path: "src", type: "tree", mode: "40000", sha: SHA },
            {
              name: "README.md",
              path: "README.md",
              type: "blob",
              mode: "100644",
              sha: SHA,
            },
          ],
          readme: {
            path: "README.md",
            text: "# Api\n\n[guide](docs/guide.md) [site](https://example.com) [up](../out)\n\n![logo](./docs/logo.png)\n",
          },
        }}
      />,
    );
    const src = screen.getByRole("link", { name: "src" });
    expect(src.getAttribute("href")).toBe("/acme/code/api/tree/feat/x/src");
    expect(
      screen.getByRole("link", { name: "README.md" }).getAttribute("href"),
    ).toBe("/acme/code/api/blob/feat/x/README.md");

    const readme = screen.getByTestId("code-readme");
    expect(readme.querySelector("h1")?.textContent).toBe("Api");
    const links = [...readme.querySelectorAll("a")].map((it) =>
      it.getAttribute("href"),
    );
    expect(links).toEqual([
      "/acme/code/api/blob/feat/x/docs/guide.md",
      "https://example.com",
      // Out of the repository: left as written.
      "../out",
    ]);
    expect(readme.querySelector("img")?.getAttribute("src")).toBe(
      `/api/projects/7/code/repos/api/raw/${SHA}/docs/logo.png`,
    );

    // The last commits fill in from one request for the whole directory.
    expect(await screen.findByText("touch src")).toBeTruthy();
    expect(treeCommits.calls.at(-1)).toMatchObject({
      params: { projectId: 7, slug: "api" },
      body: { at: "feat/x", names: ["src", "README.md"] },
    });
  });

  it("numbers and highlights a file, selects lines from the hash, and offers a permalink", async ({
    expect,
  }) => {
    window.history.replaceState(
      null,
      "",
      "/acme/code/api/blob/feat/x/src/a.ts#L2-L3",
    );
    await mount(
      <CodeBlobPage
        file={{
          revision,
          path: "src/a.ts",
          sha: SHA,
          size: 48,
          status: "ok",
          text: "const a = 1;\n/* one\ntwo */\nexport { a };\n",
        }}
      />,
    );
    const rows = screen.getByTestId("code-lines").querySelectorAll("tr");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(rows[2]?.querySelector(".hljs-comment")?.textContent).toBe("two */");
    expect([...rows].map((row) => row.hasAttribute("data-selected"))).toEqual([
      false,
      true,
      true,
      false,
    ]);

    fireEvent.click(screen.getByRole("link", { name: "4" }));
    expect(window.location.hash).toBe("#L4");
    fireEvent.click(screen.getByRole("link", { name: "1" }), {
      shiftKey: true,
    });
    expect(window.location.hash).toBe("#L1-L4");

    expect(screen.getByTestId("code-permalink")).toBeTruthy();
    expect(screen.getByTestId("code-raw").getAttribute("href")).toBe(
      `/api/projects/7/code/repos/api/raw/${SHA}/src/a.ts`,
    );
  });

  it("renders Markdown with a source toggle, and names a binary file", async ({
    expect,
  }) => {
    window.history.replaceState(
      null,
      "",
      "/acme/code/api/blob/feat/x/docs/guide.md",
    );
    await mount(
      <CodeBlobPage
        file={{
          revision,
          path: "docs/guide.md",
          sha: SHA,
          size: 20,
          status: "ok",
          text: "# Guide\n\n[back](../README.md)\n",
        }}
      />,
    );
    const rendered = screen.getByTestId("code-markdown");
    expect(rendered.querySelector("h1")?.textContent).toBe("Guide");
    expect(rendered.querySelector("a")?.getAttribute("href")).toBe(
      "/acme/code/api/blob/feat/x/README.md",
    );
    fireEvent.click(screen.getByText("Source"));
    expect(screen.getByTestId("code-lines")).toBeTruthy();
    cleanup();

    await mount(
      <CodeBlobPage
        file={{
          revision,
          path: "logo.png",
          sha: SHA,
          size: 9,
          status: "binary",
        }}
      />,
    );
    expect(screen.getByTestId("code-binary")).toBeTruthy();
    expect(screen.queryByTestId("code-lines")).toBeNull();
  });
});
