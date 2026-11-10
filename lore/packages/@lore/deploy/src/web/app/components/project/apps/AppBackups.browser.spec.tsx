import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, expect, it } from "vitest";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppBackups from "./AppBackups.tsx";

class FakeLinkProvider extends LinkProvider {
  public responses: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async () => this.responses[prop] ?? {},
      },
    );
  }
}

const INSTANCE = {
  id: "00000000-0000-4000-8000-000000000010",
  projectId: 1,
  app: "shop",
  env: "production",
  ephemeral: false,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
} as AppInstanceResource;

const ESTATE = {
  id: "00000000-0000-4000-8000-000000000020",
  slug: "acme-vps",
  online: true,
  deployAllowed: true,
};

/**
 * The Backups tab of a copy whose machine has not listed it (#Q3285): the
 * backup command needs a lent Bay and a stored name, never the inventory, so
 * the verbs are offered and the missing report is a notice above them.
 */
describe("AppBackups", () => {
  const show = async (view: Record<string, unknown>) => {
    cleanup();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    alepha.store.set(currentInstanceAtom, INSTANCE);
    alepha.store.set(currentProjectAtom, projectFixture());
    (alepha.inject(LinkProvider) as FakeLinkProvider).responses = {
      getAppBackup: { events: [], ...view },
    };

    render(
      <AlephaContext.Provider value={alepha}>
        <AppBackups />
      </AlephaContext.Provider>,
    );
    // Either the panel or the one-line card, once the read has answered.
    await screen.findByText(/./, {
      selector: '[data-testid="backup-notice"], [data-slot="card-content"]',
    });
  };

  it("offers the verbs when the machine has sent no inventory yet", async () => {
    await show({
      status: "not-reported",
      estate: ESTATE,
      machineApp: "acme-shop",
    });

    for (const verb of ["now", "list", "verify", "probe"]) {
      expect(screen.getByTestId(`backup-${verb}`)).toBeTruthy();
    }
    expect(screen.getByTestId("backup-notice").textContent).toContain(
      "has not sent its inventory yet",
    );
  });

  it("names the copy it looked for when an inventory does not list it", async () => {
    await show({
      status: "not-reported",
      estate: ESTATE,
      machineApp: "acme-shop",
      reportedAt: "2026-08-01T10:00:00.000Z",
    });

    expect(screen.getByTestId("backup-now")).toBeTruthy();
    const notice = screen.getByTestId("backup-notice").textContent ?? "";
    expect(notice).toContain("does not list this copy");
    expect(notice).toContain("acme-shop/production");
  });

  it("keeps a message and no button where there is no machine to ask", async () => {
    const cases = {
      "no-estate": "not deployed on a machine",
      "not-bay": "not a Bay machine",
      "not-lent": "no longer lent",
      "not-deployed": "has not been deployed yet",
    };
    for (const [status, words] of Object.entries(cases)) {
      await show({ status, estate: ESTATE });

      expect(screen.queryByTestId("backup-panel")).toBeNull();
      expect(screen.queryByTestId("backup-now")).toBeNull();
      expect(screen.getByTestId("app-backups").textContent).toContain(words);
    }
  });
});
