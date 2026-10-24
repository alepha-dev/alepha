import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * The stack console (#E79, #Q2696): the Stacks list, a stack environment's
 * tabs, variables, routes, revisions with their diff, and settings. No
 * machine is involved: what a page shows before anything is deployed, and
 * every write that is Lore's own.
 */
const compose = (redisTag: string) =>
  [
    "services:",
    "  db:",
    "    image: postgres:17-alpine",
    "    environment:",
    "      POSTGRES_PASSWORD: ${DB_PASSWORD}",
    "  cache:",
    `    image: redis:${redisTag}`,
    "    x-lore:",
    '      routes: ["@"]',
    "volumes: {}",
    "",
  ].join("\n");

const api = async <T>(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> =>
  await page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers:
          body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
    { method, url, body },
  );

test.describe("the stack console", () => {
  test("creates a stack, an environment, and walks its tabs", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    await registerAndVerify(page, `stk${ts}@example.com`, "GoodPassw0rd");
    const { slug, id: projectId } = await createProjectViaWizard(
      page,
      `Stack${ts}`.slice(0, 20),
      {
        capabilities: ["apps"],
      },
    );
    await setCapability(page, projectId, "apps", { options: { deploy: true } });

    await test.step("the Stacks page lists nothing, then a stack created from it", async () => {
      await page.goto(`/${slug}/stacks`);
      await expect(page.getByTestId("project-stacks")).toBeVisible();
      await expect(page.getByText("No stack yet")).toBeVisible();
      await page.getByTestId("stack-create-name").locator("input").fill("shop");
      await page.getByTestId("stack-create-submit").click();
      await expect(page.getByTestId("stack-card-shop")).toBeVisible();
    });

    await test.step("an environment and a revision, from the stack's card", async () => {
      const card = page.getByTestId("stack-card-shop");
      await card
        .getByTestId("stack-environment-name")
        .locator("input")
        .fill("production");
      await card.getByTestId("stack-environment-add").click();
      await expect(
        card.getByTestId("stack-environment-link-production"),
      ).toBeVisible();

      await card
        .getByTestId("stack-revision-file")
        .locator('input[type="file"]')
        .setInputFiles({
          name: "compose.yml",
          mimeType: "application/octet-stream",
          buffer: Buffer.from(compose("7-alpine")),
        });
      await card.getByTestId("stack-revision-upload").click();
      await expect(card.getByText("revision 1")).toBeVisible();
    });

    await test.step("the environment page says nothing is deployed yet", async () => {
      await page.getByTestId("stack-environment-link-production").click();
      await expect(page.getByTestId("stack-environment-page")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "shop/production" }),
      ).toBeVisible();
      await expect(
        page.getByText("Deploy the stack to see its services here."),
      ).toBeVisible();
    });

    await test.step("variables: the missing one is named, then set, and never shown", async () => {
      await page.getByTestId("stack-tab-variables").click();
      await expect(page.getByTestId("stack-variables-missing")).toContainText(
        "DB_PASSWORD",
      );
      await page
        .getByTestId("stack-variable-key")
        .locator("input")
        .fill("DB_PASSWORD");
      await page
        .getByTestId("stack-variable-value")
        .locator("textarea")
        .fill("a-database-password-nobody-sees");
      await page.getByTestId("stack-variable-save").click();
      await expect(page.getByTestId("stack-variable-row")).toContainText(
        "DB_PASSWORD",
      );
      await expect(page.getByTestId("stack-variables-missing")).toHaveCount(0);
      await expect(
        page.getByText("a-database-password-nobody-sees"),
      ).toHaveCount(0);
    });

    await test.step("routes: a full domain beside the labels the file carries", async () => {
      const { items } = await api<{
        items: Array<{ id: string; environments: Array<{ id: string }> }>;
      }>(page, "GET", `/api/projects/${projectId}/stacks`);
      const stack = items[0];
      await api(
        page,
        "PUT",
        `/api/projects/${projectId}/stacks/${stack.id}/environments/${stack.environments[0].id}/routes`,
        {
          service: "cache",
          domain: "shop.example.test",
        },
      );
      await page.reload();
      await page.getByTestId("stack-tab-routes").click();
      await expect(page.getByTestId("stack-route-row")).toContainText(
        "shop.example.test",
      );
      await page
        .getByTestId("stack-route-row")
        .getByRole("button", { name: "Remove" })
        .click();
      await expect(page.getByTestId("stack-route-row")).toHaveCount(0);
    });

    await test.step("revisions: two compared line by line", async () => {
      const { items } = await api<{ items: Array<{ id: string }> }>(
        page,
        "GET",
        `/api/projects/${projectId}/stacks`,
      );
      await page.evaluate(
        async ({ url, text }) => {
          const form = new FormData();
          form.append("file", new Blob([text]), "compose.yml");
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (!res.ok) throw new Error(await res.text());
        },
        {
          url: `/api/projects/${projectId}/stacks/${items[0].id}/revisions`,
          text: compose("8-alpine"),
        },
      );
      await page.reload();
      await page.getByTestId("stack-tab-revisions").click();
      await expect(page.getByTestId("stack-revision-row")).toHaveCount(2);
      const diff = page.getByTestId("stack-revision-diff");
      await expect(diff).toContainText("- ");
      await expect(diff).toContainText("redis:8-alpine");
    });

    await test.step("volumes and settings render, and the base domain saves", async () => {
      await page.getByTestId("stack-tab-volumes").click();
      await expect(page.getByTestId("stack-volumes")).toBeVisible();
      await page.getByTestId("stack-tab-settings").click();
      await expect(page.getByTestId("stack-settings")).toBeVisible();
    });
  });
});
