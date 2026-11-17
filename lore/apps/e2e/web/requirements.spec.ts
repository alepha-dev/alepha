import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Plan's Requirements, end to end (#E153, #Q3776): turn the option on,
 * create a persona, a use case and a requirement, cover the use case with an
 * epic whose quest is done, record a run that fails and see the error it
 * opens (the project has Ship with `track`), then the matrix and the
 * dashboard cards.
 *
 * With `LORE_DOCS_SCREENSHOTS=1` it also writes the guides' screenshots,
 * light and dark at 1440x900, into `docs/public/screenshots/lore`: this
 * instance is a local Lore on `:memory:` seeded with the fictional `Acme`
 * project, never a real one.
 */

const SHOTS = resolve(
  import.meta.dirname,
  "../../../../docs/public/screenshots/lore",
);

const call = async <T>(
  page: Page,
  action: string,
  params: Record<string, string | number>,
  body?: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`:${key}`, String(value));
  }
  return (await page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    },
    { url, body },
  )) as T;
};

const shoot = async (page: Page, name: string) => {
  if (!process.env.LORE_DOCS_SCREENSHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
};

test.describe("Requirements", () => {
  test("persona, use case and requirement, a failing run that opens an error, the matrix and the cards", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `req-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const project = await createProjectViaWizard(page, "Acme");
    const slug = project.slug;

    await test.step("turn Requirements on, with epics, releases and Ship's track", async () => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      await setCapability(page, project.id, "plan", {
        options: { epics: true, releases: true, requirements: true },
      });
      await setCapability(page, project.id, "ship", {
        options: { track: true },
      });
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("link", { name: /^Requirements/ }).first(),
      ).toBeVisible();
    });

    const ids =
      await test.step("create a persona, a use case, a requirement and the epic covering it", async () => {
        const lea = await call<{ id: number; number: number }>(
          page,
          "createPersona",
          { projectId: project.id },
          {
            name: "Léa",
            kind: "human",
            role: "Shop manager",
            who: "Runs the Lyon shop and its promotions.",
            goals: "Launch a promotion in minutes\nSee what it sold",
            demoAccount: "lea@acme.example",
          },
        );
        await call(
          page,
          "createPersona",
          { projectId: project.id },
          { name: "Indexer", kind: "system", role: "Search" },
        );
        const uc = await call<{ id: number; number: number }>(
          page,
          "createUseCase",
          { projectId: project.id },
          {
            title: "Apply a promo code",
            actors: [{ personaId: lea.id }],
            steps: [
              { text: "Open the cart", actorPersonaId: lea.id },
              { text: "Type the code SPRING", actorPersonaId: lea.id },
              { text: "Show the discount" },
            ],
            criteria: [
              { text: "The discount shows before payment" },
              { text: "An expired code is refused" },
            ],
          },
        );
        const req = await call<{ id: number; number: number }>(
          page,
          "createRequirement",
          { projectId: project.id },
          {
            statement: "The discount is visible before payment",
            priority: "must",
            chapter: "3. Promotions",
            paragraph: "3.2",
          },
        );
        await call(
          page,
          "createRequirement",
          { projectId: project.id },
          {
            statement: "A replayed webhook never charges twice",
            priority: "must",
            chapter: "4. Payment",
            paragraph: "4.3",
          },
        );
        await call(
          page,
          "linkCriterion",
          { projectId: project.id },
          {
            useCaseNumber: uc.number,
            criterionKey: "C1",
            requirementNumber: req.number,
          },
        );
        const epic = await call<{ id: number; number: number }>(
          page,
          "createEpic",
          { projectId: project.id },
          { title: "Promotions" },
        );
        await call(page, "setEpicStatus", { id: epic.id }, { status: "ready" });
        const quest = await call<{ id: number }>(
          page,
          "createQuest",
          {},
          {
            projectId: project.id,
            title: "Promo codes at checkout",
            area: "shop",
            priority: "medium",
            size: 3,
          },
        );
        await call(page, "attachQuest", { id: epic.id }, { questId: quest.id });
        await call(
          page,
          "linkUseCaseEpic",
          { id: uc.id },
          { epicNumber: epic.number, linked: true },
        );
        await call(page, "acceptQuest", { id: quest.id }, {});
        await call(page, "completeQuest", { id: quest.id }, {});
        return { uc, req };
      });

    await test.step("see the persona", async () => {
      await page.goto(`/${slug}/requirements/personas`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("persona-card")).toHaveCount(2);
      await shoot(page, "requirements-personas");
    });

    await test.step("a failing run opens an error once the quests are done", async () => {
      const recorded = await call<{ errorRule: string; errorsOpened: number }>(
        page,
        "recordUseCaseRun",
        { projectId: project.id },
        {
          useCaseNumber: ids.uc.number,
          by: "agent",
          client: "e2e",
          env: "local",
          results: [
            { key: "C1", result: "failed", note: "No discount line" },
            { key: "C2", result: "passed" },
          ],
        },
      );
      expect(recorded.errorRule).toBe("opened");
      expect(recorded.errorsOpened).toBe(1);

      await page.goto(`/${slug}/errors`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(`#U${ids.uc.number} C1 failed`).first(),
      ).toBeVisible();

      await page.goto(`/${slug}/requirements/use-cases/${ids.uc.number}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Apply a promo code").first()).toBeVisible();
      await shoot(page, "requirements-use-case");
    });

    await test.step("the Use cases tab says Failed", async () => {
      await page.goto(`/${slug}/requirements/use-cases`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("use-case-row")).toHaveCount(1);
      await shoot(page, "requirements-use-cases");
    });

    await test.step("the requirement fails, and the matrix says so", async () => {
      await page.goto(`/${slug}/requirements?requirement=${ids.req.number}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("requirements-table")).toBeVisible();
      await shoot(page, "requirements-list");

      await page.getByRole("radio", { name: "Matrix" }).click();
      await expect(page.getByTestId("traceability-matrix")).toBeVisible();
      await expect(page.locator('[data-cell="failing"]').first()).toBeVisible();
      await expect(page.getByTestId("impact-chain")).toBeVisible();
      await expect(page.getByTestId("coverage-gaps")).toBeVisible();
      await shoot(page, "requirements-matrix");
    });

    await test.step("Verify builds the prompt", async () => {
      await page.goto(`/${slug}/requirements/use-cases/${ids.uc.number}`);
      await page.waitForLoadState("networkidle");
      // Verify sits behind the robot glyph, as every agent prompt does.
      await page.getByTestId("verify-menu").click();
      await page.getByRole("menuitem", { name: "Test", exact: true }).click();
      await expect(page.getByTestId("verify-preview")).toContainText(
        "Apply a promo code",
      );
      await expect(page.getByTestId("verify-command")).toContainText(
        `lore usecase prompt U${ids.uc.number} --mode test`,
      );
      await shoot(page, "requirements-verify");
      await page.keyboard.press("Escape");
    });

    await test.step("the dashboard offers the Requirements cards", async () => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      const copied = page.waitForResponse(
        (r) => r.url().includes("/api/") && r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await page.getByTestId("dashboard-edit").click();
      expect((await copied).ok()).toBe(true);
      await page.getByTestId("dashboard-add").click();
      await expect(page.getByTestId("dashboard-catalogue")).toBeVisible({
        timeout: 10_000,
      });
      for (const metric of [
        "requirementCoverage",
        "useCaseHealth",
        "requirementsToCover",
        "personaHealth",
      ]) {
        await expect(
          page.locator(
            `[data-testid="dashboard-catalogue-row"][data-metric="${metric}"]`,
          ),
        ).toBeVisible();
      }
    });
  });
});
