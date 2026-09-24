import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { AdminMcp } from "./AdminMcp.client.tsx";

/**
 * Answers `readMcpCalls` with a fixed body. Substitution rather than
 * `vi.mock`, per `CLAUDE.md`.
 */
class McpLinkProvider extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: () =>
          Object.assign(
            async () => ({
              days: ["2026-09-23", "2026-09-24"],
              tools: [],
              leaderboard: [
                { tool: "quest_get", total: 12, ok: 10, refused: 2, errors: 0 },
                { tool: "folio_get", total: 30, ok: 29, refused: 0, errors: 1 },
              ],
              estimated: false,
            }),
            { can: () => true },
          ),
      },
    );
  }
}

/**
 * `/admin/mcp` as one DataTable with the chart above its rows (#Q2498).
 */
describe("AdminMcp", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async () => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: McpLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminMcp />
      </AlephaContext.Provider>,
    );
  };

  it("lists every tool in a table, busiest first, with its outcomes", async ({
    expect,
  }) => {
    await show();

    await waitFor(() => expect(screen.getByText("folio_get")).toBeTruthy());
    const rows = screen
      .getAllByRole("row")
      .map((row) => row.textContent ?? "")
      .filter((text) => text.includes("_get"));
    expect(rows[0]).toContain("folio_get");
    expect(rows[1]).toContain("quest_get");
    for (const header of ["Tool", "Calls", "OK", "Refused", "Errors"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
  });

  it("draws the thirty-day total above the rows, and no page title", async ({
    expect,
  }) => {
    const view = await show();

    await waitFor(() =>
      expect(view.container.textContent).toContain("42calls over 2 days"),
    );
    expect(
      screen.queryByRole("heading", { name: "MCP tool calls" }),
    ).toBeNull();
  });
});
