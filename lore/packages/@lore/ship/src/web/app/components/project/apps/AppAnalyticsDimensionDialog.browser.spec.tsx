import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppAnalyticsDimensionDialog from "./AppAnalyticsDimensionDialog.tsx";

/**
 * Answers the one leaderboard read, and records what it was asked.
 */
class Links extends LinkProvider {
  public queries: Array<Record<string, unknown>> = [];

  override client(): any {
    const getInsightsDimension = async (args: {
      params: { dimension: string };
      query: Record<string, unknown>;
    }) => {
      this.queries.push({ dimension: args.params.dimension, ...args.query });
      return {
        rows: [
          { value: "/checkout", visitors: 9, views: 12, percentage: 60 },
          { value: "/", visitors: 5, views: 8, percentage: 40 },
        ],
        hasMore: false,
      };
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any =
          key === "getInsightsDimension"
            ? getInsightsDimension
            : async () => ({});
        action.can = () => true;
        return action;
      },
    });
  }
}

const instance = {
  id: "00000000-0000-4000-8000-000000000010",
  projectId: 1,
  app: "docs",
  env: "production",
  ephemeral: false,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  sigilId: "00000000-0000-4000-8000-000000000001",
  sigil: {
    id: "00000000-0000-4000-8000-000000000001",
    tokenPrefix: "sg_lore_ab",
    kinds: ["beacon"],
    createdAt: "2026-08-01T10:00:00.000Z",
  },
} as AppInstanceResource;

/**
 * A leaderboard's full list, in a dialog over the Analytics tab (#Q3674).
 */
describe("AppAnalyticsDimensionDialog", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: {
    dimension?: "path";
    onPick?: (dimension: string, value: string) => void;
    onClose?: () => void;
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ title: "Alepha", slug: "alepha" }),
    );
    alepha.store.set(currentInstanceAtom, instance);
    render(
      <AlephaContext.Provider value={alepha}>
        <AppAnalyticsDimensionDialog
          dimension={props.dimension}
          onPick={props.onPick ?? (() => {})}
          onClose={props.onClose ?? (() => {})}
        />
      </AlephaContext.Provider>,
    );
    return alepha.inject(LinkProvider) as Links;
  };

  it("lists the leaderboard in full, with the tab's window, and picks a row", async ({
    expect,
  }) => {
    const picked: Array<[string, string]> = [];
    const links = await mount({
      dimension: "path",
      onPick: (dimension, value) => picked.push([dimension, value]),
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Top pages");
    await waitFor(() => expect(screen.getByText("/checkout")).toBeTruthy());
    expect(links.queries[0]).toMatchObject({
      dimension: "path",
      range: "thisMonth",
      traffic: "all",
      sigilId: instance.sigil?.id,
    });

    fireEvent.click(screen.getByText("/checkout"));
    expect(picked).toEqual([["path", "/checkout"]]);
  });

  it("renders nothing and asks for nothing while closed", async ({
    expect,
  }) => {
    const links = await mount({});

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(links.queries).toEqual([]);
  });
});
