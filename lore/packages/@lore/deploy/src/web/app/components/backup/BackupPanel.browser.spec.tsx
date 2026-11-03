import { I18n } from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import BackupPanel, { type BackupSource } from "./BackupPanel.tsx";

/**
 * Restoring from another instance's backups (`from`) is the estate owner's
 * alone: the project route refuses it whatever is sent, so its Backups tab
 * must not offer the field.
 */
describe("BackupPanel", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (canRestoreFrom: boolean) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const source: BackupSource = {
      appLabel: "acme-shop",
      events: [],
      online: true,
      deployAllowed: true,
      canManage: true,
      canRestoreFrom,
      send: async () => {
        throw new Error("not sent in this spec");
      },
      poll: async () => undefined,
      result: async () => undefined,
      reload: () => {},
    };
    return render(
      <AlephaContext.Provider value={alepha}>
        <BackupPanel source={source} />
      </AlephaContext.Provider>,
    );
  };

  it("hides 'restore from' where the route refuses it", async () => {
    await mount(false);
    expect(screen.getByTestId("backup-restore-reason")).toBeTruthy();
    expect(screen.queryByTestId("backup-restore-from")).toBeNull();
  });

  it("offers it on the estate owner's console", async () => {
    await mount(true);
    expect(screen.getByTestId("backup-restore-from")).toBeTruthy();
  });
});
