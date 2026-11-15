import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminFailedAuditsTile } from "../AdminFailedAuditsTile.tsx";

/**
 * The audit log, faked at the link layer: it answers `findAudits` the way
 * the server filters, by `success` and by an optional comma list of types.
 */
class Links extends LinkProvider {
  public audits = [
    { type: "auth", success: false },
    { type: "security", success: false },
    // An app's own `$audit.logFailure`: the case #Q3668 is about.
    { type: "payment", success: false },
    { type: "auth", success: true },
  ];
  public queries: Array<Record<string, unknown>> = [];

  override client(): any {
    const findAudits = async (args: { query: Record<string, unknown> }) => {
      this.queries.push(args.query);
      const types =
        typeof args.query.type === "string"
          ? args.query.type.split(",")
          : undefined;
      const total = this.audits.filter(
        (audit) =>
          audit.success === args.query.success &&
          (!types || types.includes(audit.type)),
      ).length;
      return { content: [], page: { totalElements: total } };
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any =
          key === "findAudits" ? findAudits : async () => ({});
        action.can = () => true;
        return action;
      },
    });
  }
}

/**
 * The dashboard's failed audits tile (#Q3668): every audit with
 * `success: false`, whatever its type, where it used to count `auth` and
 * `security` only.
 */
describe("AdminFailedAuditsTile", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("counts a failed audit of any type, and links to the same list", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    const links = alepha.inject(LinkProvider) as Links;

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <AdminFailedAuditsTile id="failed-audits" />
      </AlephaContext.Provider>,
    );

    await waitFor(() =>
      expect(
        view.container.querySelector("[data-slot=stat-value]")?.textContent,
      ).toBe("3"),
    );
    expect(view.container.textContent).toContain("Failed audits");
    // Both windows, failed only, no type filter.
    expect(links.queries).toHaveLength(2);
    for (const query of links.queries) {
      expect(query.success).toBe(false);
      expect(query).not.toHaveProperty("type");
    }
    const href = view.container.querySelector("a")?.getAttribute("href");
    expect(href).toMatch(/^\/admin\/audits\?status=failed&createdAt=/);
    expect(href).not.toContain("type=");
  });
});
