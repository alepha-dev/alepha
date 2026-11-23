import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  createProjectViaWizard,
  newUserContext,
  openAccount,
  registerAndVerify,
  saveRank,
  setCapability,
} from "./_helpers.ts";

/**
 * The code browser (#E167, #Q4140), on a self-hosted Lore: a repository
 * created and pushed to with git, then read in the browser, from the tree to
 * a blame line leading to its quest. And a member on a rank without
 * `code:read`, for whom every code page does not exist.
 */

/**
 * `git` in a working copy with a fixed identity, never a prompt and no
 * global config.
 */
const gitIn =
  (dir: string, home: string) =>
  (...args: string[]) =>
    execFileSync("git", ["-c", "credential.helper=", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Ada Lore",
        GIT_AUTHOR_EMAIL: "ada@example.com",
        GIT_COMMITTER_NAME: "Ada Lore",
        GIT_COMMITTER_EMAIL: "ada@example.com",
      },
    }).trim();

const write = (dir: string, path: string, content: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
};

/**
 * A project with Build's repositories on, its repository named like it, and
 * an API key to push with.
 */
const aRepository = async (page: Page, title: string) => {
  const project = await createProjectViaWizard(page, title);
  await setCapability(page, project.id, "build", {
    enabled: true,
    options: { repositories: true, quality: true },
  });
  const created = await page.request.post(
    (await apiPath(page, "createCodeRepository")).replace(
      ":projectId",
      String(project.id),
    ),
    { data: { slug: project.slug } },
  );
  expect(created.ok(), await created.text()).toBe(true);
  const key = await page.request.post(await apiPath(page, "createApiKey"), {
    data: { name: "git" },
  });
  expect(key.ok(), await key.text()).toBe(true);
  const token = ((await key.json()) as { token: string }).token;
  return { ...project, token };
};

const invite = async (
  page: Page,
  slug: string,
  email: string,
  rank: RegExp,
) => {
  await page.goto(`/${slug}/settings/members`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^invite$/i }).click();
  await page.getByPlaceholder("user@example.com").fill(email);
  await page.getByTestId("invite-rank").click();
  await page.getByRole("option", { name: rank }).click();
  const sent = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/invitations"),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /send invitation/i }).click();
  expect((await sent).ok()).toBe(true);
};

test.describe("Code browser", () => {
  test("from a push to a blame line leading to its quest", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const t = Date.now();
    await registerAndVerify(page, `code${t}@example.com`, "CodePass123!");
    const project = await aRepository(page, `Code${t}`.slice(0, 20));
    const quest = await apiPost<{ shortId: number }>(page, "createQuest", {
      projectId: project.id,
      title: "Greet the reader",
      description: "seeded",
      area: "Main",
      priority: "medium",
      objectives: [],
    });

    // A small history: a README, a commit naming the quest, a branch with
    // a slash in its name.
    const home = mkdtempSync(join(tmpdir(), "lore-e2e-code-"));
    try {
      const work = join(home, "work");
      mkdirSync(work);
      const git = gitIn(work, home);
      git("init", "--quiet", "-b", "main");
      write(work, "README.md", "# Hello\n\nSee [the guide](docs/guide.md).\n");
      write(work, "docs/guide.md", "# Guide\n");
      write(work, "src/hello.ts", "export const hello = 1;\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "first");
      const remote = new URL(`${baseURL}/${project.slug}.git`);
      remote.username = "x";
      remote.password = project.token;
      // The branch's creation first: a commit lands on a quest when it
      // reaches a branch that already existed.
      git("push", "--quiet", remote.toString(), "main");
      write(
        work,
        "src/hello.ts",
        "export const hello = 1;\nexport const world = 2;\n",
      );
      git(
        "commit",
        "--quiet",
        "-am",
        `feat: greet the world #Q${quest.shortId}`,
      );
      git("checkout", "--quiet", "-b", "feat/x");
      write(work, "src/side.ts", "export const side = true;\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "side work");
      git("checkout", "--quiet", "main");
      git("push", "--quiet", remote.toString(), "main", "feat/x");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }

    await test.step("the Code entry opens the repository, its tree and README", async () => {
      await page.goto(`/${project.slug}`);
      await page
        .getByRole("link", { name: /^code$/i })
        .first()
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${project.slug}/code/${project.slug}$`),
      );
      await expect(page.getByTestId("code-readme")).toContainText("Hello", {
        timeout: 15_000,
      });
      await expect(
        page.getByTestId("code-tree").getByRole("link", { name: "src" }),
      ).toBeVisible();
    });

    await test.step("a file, highlighted and numbered, and its history", async () => {
      await page.goto(
        `/${project.slug}/code/${project.slug}/blob/main/src/hello.ts`,
      );
      await expect(page.getByTestId("code-lines")).toContainText("world", {
        timeout: 15_000,
      });
      await page.getByTestId("code-history").click();
      await expect(page.getByTestId("code-commits")).toContainText(
        "feat: greet the world",
        { timeout: 15_000 },
      );
    });

    await test.step("a commit, its diff and its quest", async () => {
      await page
        .getByRole("link", { name: /feat: greet the world/ })
        .first()
        .click();
      await expect(page.getByTestId("code-commit")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("code-diff-file").first()).toContainText(
        "export const world = 2;",
      );
      await expect(
        page.getByTestId("code-commit").getByRole("link", {
          name: `#Q${quest.shortId}`,
          exact: true,
        }),
      ).toHaveAttribute("href", `/${project.slug}/quests/${quest.shortId}`);
    });

    await test.step("two branches compared, one named with a slash", async () => {
      await page.goto(
        `/${project.slug}/code/${project.slug}/compare/main...feat/x`,
      );
      await expect(page.getByTestId("code-compare-counts")).toContainText("1", {
        timeout: 15_000,
      });
      await expect(page.getByTestId("code-compare")).toContainText("side work");
    });

    await test.step("a blame line leading to its quest", async () => {
      await page.goto(
        `/${project.slug}/code/${project.slug}/blame/main/src/hello.ts`,
      );
      const run = page.getByTestId("code-blame-run").nth(1);
      await expect(run).toContainText("feat: greet the world", {
        timeout: 20_000,
      });
      await run
        .getByRole("link", { name: `#Q${quest.shortId}`, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${project.slug}/quests/${quest.shortId}`),
      );
    });

    await test.step("the quest's commit links back into the repository", async () => {
      await expect(
        page
          .locator(`a[href^="/${project.slug}/code/${project.slug}/commit/"]`)
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test("a member on a rank without code:read meets no code page", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const t = Date.now();
    await registerAndVerify(page, `codeowner${t}@example.com`, "CodePass123!");
    const project = await aRepository(page, `NoCode${t}`.slice(0, 20));
    // A custom rank that is Viewer without any code permission (a Viewer
    // seeded with Build on holds code:read).
    const ranks = (await (
      await page.request.get(
        (await apiPath(page, "getOrganizationRanks")).replace(
          ":organizationId",
          project.organizationId,
        ),
      )
    ).json()) as { items: Array<{ key: string; permissions: string[] }> };
    const viewer = ranks.items.find((it) => it.key === "viewer");
    await saveRank(
      page,
      project.organizationId,
      "no-code",
      "No code",
      viewer!.permissions.filter((it) => !it.startsWith("code:")),
    );
    const reader = await newUserContext(browser, baseURL!, "nocode");
    try {
      await invite(page, project.slug, reader.email, /^no code$/i);
      await openAccount(reader.page, "invitations");
      const accepted = reader.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
        { timeout: 15_000 },
      );
      await reader.page.getByRole("button", { name: /^accept$/i }).click();
      expect((await accepted).ok()).toBe(true);

      // The project itself opens; its code does not exist.
      await reader.page.goto(`/${project.slug}/activity`);
      await reader.page.waitForLoadState("networkidle");
      await expect(reader.page.getByText(/something went wrong/i)).toHaveCount(
        0,
      );
      for (const path of [
        `/${project.slug}/code`,
        `/${project.slug}/code/${project.slug}`,
        `/${project.slug}/code/${project.slug}/commits/main`,
        `/${project.slug}/code/${project.slug}/branches`,
      ]) {
        await reader.page.goto(path);
        await reader.page.waitForLoadState("networkidle");
        await expect(
          reader.page.getByText(/page not found/i),
          path,
        ).toBeVisible({ timeout: 10_000 });
      }
    } finally {
      await reader.ctx.close();
    }
  });
});
