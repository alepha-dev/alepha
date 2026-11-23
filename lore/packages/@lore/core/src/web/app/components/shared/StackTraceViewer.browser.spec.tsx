import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import { StackTraceParser } from "../../services/StackTraceParser.ts";
import StackTraceViewer from "./StackTraceViewer.tsx";

const STACK = [
  "DbError: Query select has failed",
  "    at PostgresProvider.execute (/app/node_modules/alepha/dist/orm.js:120:11)",
  "    at QuestService.list (/app/src/QuestService.ts:44:5)",
  "Caused by: SqliteError: no such column: <img src=x onerror=alert(1)>",
].join("\n");

/**
 * The Errors page's stack viewer (#Q4186): one section per error of the
 * chain, frames one per line, dependencies dimmed, and the attacker-written
 * text shown as text.
 */
describe("StackTraceViewer", () => {
  let alepha: Alepha | undefined;
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(StackTraceParser);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <StackTraceViewer stack={STACK} />
      </AlephaContext.Provider>,
    );
  };

  it("draws the error and its cause as two sections, frames one per line", async ({
    expect,
  }) => {
    await show();

    const sections = screen.getAllByTestId("stack-trace-error");
    expect(sections).toHaveLength(2);
    expect(sections[0]!.querySelectorAll("li")).toHaveLength(2);
    expect(sections[1]!.textContent).toContain("Caused by");
    expect(sections[1]!.textContent).toContain("SqliteError");
  });

  it("dims a dependency's frame and not the app's own", async ({ expect }) => {
    await show();

    const [dependency, own] = screen
      .getAllByTestId("stack-trace-error")[0]!
      .querySelectorAll("li");
    expect(dependency!.hasAttribute("data-external")).toBe(true);
    expect(own!.hasAttribute("data-external")).toBe(false);
  });

  it("shows a message as text, never as markup", async ({ expect }) => {
    await show();

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror=alert/)).toBeTruthy();
  });

  it("offers to copy the stack", async ({ expect }) => {
    await show();

    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});
