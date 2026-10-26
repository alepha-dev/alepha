import { expect, test } from "@playwright/test";

/*
 * The whole loop in a browser, against the Node build: ask, see the
 * confirmation the server stored, approve, and see the page change. The model
 * is the in-memory provider, scripted by `E2eScript` to answer with a
 * `createNote` call and then a reply.
 */
test("asks, confirms the write, and the page shows the new note", async ({
  page,
}) => {
  await page.goto("/");
  // Hydrated: the button answers.
  await expect(
    page.getByRole("button", { name: "Ask the assistant" }),
  ).toBeEnabled();
  await expect(page.getByTestId("notes").getByText("Buy milk")).toHaveCount(0);

  await page.getByRole("button", { name: "Ask the assistant" }).click();
  const chat = page.getByTestId("ai-chat");
  await chat.locator("textarea").fill("Add a note to buy milk");
  await chat.getByRole("button", { name: "Send" }).click();

  const card = chat.getByTestId("ai-chat-confirm");
  await expect(card).toContainText("Run createNote?");
  await expect(card).toContainText("Buy milk");
  await expect(page.getByTestId("notes").getByText("Buy milk")).toHaveCount(0);

  await card.getByRole("button", { name: "Approve" }).click();
  await expect(chat.getByText("Done: the note is added.")).toBeVisible();
  await expect(page.getByTestId("notes").getByText("Buy milk")).toBeVisible();
});
