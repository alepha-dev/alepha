import { cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AdminAudits } from "../AdminAudits.tsx";
import { AdminSessions } from "../AdminSessions.tsx";

/**
 * The admin API, as a fake server whose facet reads (the audit action pairs,
 * the session countries) fail, and whose lists answer an empty page.
 */
class Links extends LinkProvider {
  override client(): any {
    const empty = {
      content: [],
      page: {
        number: 0,
        size: 10,
        offset: 0,
        numberOfElements: 0,
        totalElements: 0,
        totalPages: 0,
        isEmpty: true,
        isFirst: true,
        isLast: true,
      },
    };
    const actions: Record<string, any> = {
      getAuditActions: async () => {
        throw new Error("audit actions unavailable");
      },
      getSessionCountries: async () => {
        throw new Error("session countries unavailable");
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => empty);
        action.can = () => true;
        return action;
      },
    });
  }
}

/**
 * A failed facet read used to be swallowed: the Type, Action or Country
 * filter stayed empty and nothing said why. It is a query now, so the
 * failure reaches the app's action-error toaster.
 */
describe("admin facet reads", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const reportedFor = async (page: ReactNode): Promise<string[]> => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    const reported: string[] = [];
    alepha.events.on("react:action:error", ({ error }) => {
      reported.push(error.message);
    });
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{page}</DialogProvider>
      </AlephaContext.Provider>,
    );
    return reported;
  };

  it("reports a failed audit action list", async () => {
    const reported = await reportedFor(<AdminAudits />);
    await waitFor(() =>
      expect(reported).toContain("audit actions unavailable"),
    );
  });

  it("reports a failed session country list", async () => {
    const reported = await reportedFor(<AdminSessions />);
    await waitFor(() =>
      expect(reported).toContain("session countries unavailable"),
    );
  });
});
