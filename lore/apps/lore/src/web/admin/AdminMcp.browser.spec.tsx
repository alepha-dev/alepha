import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { AdminMcp } from "./AdminMcp.client.tsx";

/**
 * Answers `readMcpCalls` with a fixed body. Substitution rather than
 * `vi.mock`, per `AGENTS.md`.
 */
class McpLinkProvider extends LinkProvider {
  public queries: Array<Record<string, unknown>> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: () =>
          Object.assign(
            async (request?: { query?: Record<string, unknown> }) => {
              this.queries.push(request?.query ?? {});
              return {
                days: ["2026-09-23", "2026-09-24"],
                tools: [],
                leaderboard: [
                  {
                    tool: "quest_get",
                    total: 12,
                    ok: 10,
                    refused: 2,
                    errors: 0,
                  },
                  {
                    tool: "folio_get",
                    total: 30,
                    ok: 29,
                    refused: 0,
                    errors: 1,
                  },
                ],
                estimated: false,
              };
            },
            { can: () => true },
          ),
      },
    );
  }
}

/**
 * The page's own path, so a link carrying filters can be opened.
 */
class AdminRoutes {
  mcp = $page({ path: "/admin/mcp", component: () => null });
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
    // The table stores its filters; a case must not inherit the last one's.
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  const show = async (url = "/admin/mcp") => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: McpLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.with(AdminRoutes);
    await alepha.start();
    await act(async () => {
      await alepha!.inject(ReactRouter).push(url as `/${string}`);
    });
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

  /**
   * The filters (#Q3665): the period, the outcome and the tool search reach
   * `readMcpCalls`, which answers the chart and the rows alike, and a link
   * carrying them opens the page narrowed.
   */
  it("sends the filters a link carries to the read", async ({ expect }) => {
    await show("/admin/mcp?days=7&outcome=error&search=quest");
    const links = alepha!.inject(LinkProvider) as McpLinkProvider;

    await waitFor(() =>
      expect(links.queries.at(-1)).toEqual({
        days: "7",
        outcome: "error",
        tool: "quest",
      }),
    );
  });

  it("asks for the default window when nothing is filtered", async ({
    expect,
  }) => {
    await show();
    const links = alepha!.inject(LinkProvider) as McpLinkProvider;

    await waitFor(() => expect(screen.getByText("folio_get")).toBeTruthy());
    expect(links.queries.at(-1)).toEqual({});
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
