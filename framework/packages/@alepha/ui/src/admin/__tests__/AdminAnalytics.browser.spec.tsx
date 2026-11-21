import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminAnalytics } from "../AdminAnalytics.tsx";
import type { AnalyticsTransport } from "../analytics/analyticsTypes.ts";

/**
 * No admin API: the page is given its own transport below.
 */
class Links extends LinkProvider {
  override client(): any {
    return {};
  }
}

/**
 * The dataset list is the page's first read: when it fails the page says so
 * instead of staying an empty pane forever.
 */
describe("AdminAnalytics", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  it("says the datasets could not be loaded when the list fails", async () => {
    const transport: AnalyticsTransport = {
      listDatasets: async () => {
        throw new Error("500 Internal Server Error");
      },
      queryDataset: async () => {
        throw new Error("not reached");
      },
      path: (dataset) => `/api/admin/analytics/datasets/${dataset}/query`,
    };
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <AdminAnalytics transport={transport} />
      </AlephaContext.Provider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText("The analytics datasets could not be loaded."),
      ).toBeTruthy(),
    );
  });
});
