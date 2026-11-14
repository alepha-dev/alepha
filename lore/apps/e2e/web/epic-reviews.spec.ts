import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Epic reviews, end to end (#E121): a review filed through the API shows on
 * the epic's Review tab, numbered; one question is answered by picking a
 * suggestion and the other waived; marking the epic ready with a question
 * still open asks first and goes through; and the epic detail the agent
 * reads carries the decision log.
 */

/**
 * One JSON call through the page's own session, failing loudly.
 */
const call = async <T>(
  page: Page,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> =>
  (await page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
      return r.json();
    },
    { method, path, body },
  )) as T;

test.describe("Epic reviews", () => {
  test("a review is filed, answered on the Review tab, and asked about on ready", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `review${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Rv${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "plan", { options: { epics: true } });

    const epic = await call<{ id: number; number: number }>(
      page,
      "POST",
      `/api/createEpic/${projectId}`,
      { title: `Reviewed${t}` },
    );

    const review = await call<{ items: Array<{ number: number }> }>(
      page,
      "POST",
      `/api/createEpicReview/${epic.id}`,
      {
        summary: "Two questions and a call.",
        items: [
          {
            kind: "question",
            title: "Which table holds it?",
            context: "The spec says one, the code two.",
            suggestions: [
              { label: "One table", cost: "a rebuild" },
              { label: "Two tables", cost: "a join" },
            ],
            recommended: 1,
          },
          { kind: "question", title: "Notify the owner?" },
          { kind: "decision", title: "Keep the name.", context: "It shipped." },
        ],
      },
    );
    expect(review.items.map((item) => item.number)).toEqual([1, 2, 3]);

    await test.step("the list shows the open count on the title's line", async () => {
      // A second epic, never reviewed: the row to measure against (#Q3296).
      const plain = await call<{ number: number }>(
        page,
        "POST",
        `/api/createEpic/${projectId}`,
        { title: `Plain${t}` },
      );
      await page.goto(`/${slug}/epics`);
      const count = page.getByTestId(`epic-open-questions-${epic.number}`);
      await expect(count).toHaveText("2 review questions open", {
        timeout: 15_000,
      });
      const reviewedRow = page.getByRole("row").filter({ has: count });
      const plainRow = page
        .getByRole("row")
        .filter({ has: page.getByTestId(`epic-title-line-${plain.number}`) });
      const [reviewedBox, plainBox, countBox, titleBox] = await Promise.all([
        reviewedRow.boundingBox(),
        plainRow.boundingBox(),
        count.boundingBox(),
        page
          .getByTestId(`epic-title-line-${epic.number}`)
          .getByRole("link")
          .boundingBox(),
      ]);
      expect(reviewedBox!.height).toBe(plainBox!.height);
      // Same line: the count starts right of the title and overlaps it in y.
      expect(countBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width);
      expect(countBox!.y).toBeLessThan(titleBox!.y + titleBox!.height);
      expect(countBox!.y + countBox!.height).toBeGreaterThan(titleBox!.y);
    });

    await test.step("the Review tab lists the questions, numbered", async () => {
      await page.goto(`/${slug}/epics/${epic.number}?tab=review`);
      await expect(page.getByText("Open questions (2)")).toBeVisible({
        timeout: 15_000,
      });
      const first = page.getByTestId("epic-review-question-1");
      await expect(first).toContainText("Which table holds it?");
      await expect(first).toContainText("Recommended");
      await expect(page.getByTestId("epic-review-question-2")).toContainText(
        "Notify the owner?",
      );
      await expect(page.getByTestId("epic-review-log-3")).toContainText(
        "Keep the name.",
      );
    });

    await test.step("a suggestion answers the first question", async () => {
      await page
        .getByTestId("epic-review-question-1")
        .getByRole("button", { name: "Take this" })
        .nth(1)
        .click();
      await expect(page.getByTestId("epic-review-question-1")).toHaveCount(0);
      await expect(page.getByTestId("epic-review-log-1")).toContainText(
        "Two tables",
      );
      await expect(page.getByText("Open questions (1)")).toBeVisible();
    });

    await test.step("marking it ready with one open asks first, then goes", async () => {
      await page.getByRole("button", { name: "Mark as ready" }).click();
      await expect(
        page.getByText("1 review question is still open"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Mark as ready anyway" }).click();
      await expect(
        page.getByRole("button", { name: "Back to draft" }),
      ).toBeVisible();
    });

    await test.step("the second question is waived while the epic is ready", async () => {
      await page
        .getByTestId("epic-review-question-2")
        .getByRole("button", { name: "Waive" })
        .click();
      await expect(page.getByText("No review question is open.")).toBeVisible();
    });

    await test.step("the epic detail carries the decision log", async () => {
      const detail = await call<{
        reviews: {
          openQuestions: number;
          reviews: Array<{
            items: Array<{
              number: number;
              state?: string;
              answer?: string;
            }>;
          }>;
        };
      }>(page, "GET", `/api/getEpicDetailByNumber/${projectId}/${epic.number}`);
      expect(detail.reviews.openQuestions).toBe(0);
      const items = detail.reviews.reviews[0]!.items;
      expect(items.find((item) => item.number === 1)).toMatchObject({
        state: "answered",
        answer: "Two tables",
      });
      expect(items.find((item) => item.number === 2)?.state).toBe("waived");
    });

    await test.step("the Activity tab shows the review and its answers", async () => {
      await page.goto(`/${slug}/epics/${epic.number}?tab=activity`);
      await expect(
        page.getByText(
          "filed a review (questions: 2, decisions: 1, changes: 0)",
        ),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("answered item 1")).toBeVisible();
      await expect(page.getByText("waived item 2")).toBeVisible();
    });
  });
});
