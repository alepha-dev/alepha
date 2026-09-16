import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Folio } from "@/api/entities/folios.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import FolioHistoryTab from "./FolioHistoryTab.tsx";

const revisionOf = (id: string, at: string) => ({
  id,
  folioId: "f1",
  action: "edit",
  at,
  pinned: false,
});

/**
 * Serves two revisions, and refuses the revert.
 */
class FakeLinkProvider extends LinkProvider {
  reverts = 0;
  reverted = 0;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listHistory: async () => [
        revisionOf("r2", "2026-09-14T11:00:00.000Z"),
        revisionOf("r1", "2026-09-14T10:00:00.000Z"),
      ],
      revertHistory: async () => {
        this.reverts++;
        throw new Error("This folio was protected since (spec)");
      },
      update: async () => ({}),
    });
  }
}

/**
 * A revert is a `useAction` whose handler holds the confirmation and the
 * `onReverted` follow-up (#E59, #Q2331). It used to be a plain function with
 * a `try/finally` and no catch, so a refused revert was an unhandled
 * rejection. Now the root listener says why, exactly once, and the folio is
 * not re-baselined over a revert that did not happen.
 */
describe("FolioHistoryTab", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("toasts a refused revert exactly once, and reports no revert", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const fake = alepha.inject(FakeLinkProvider);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <FolioHistoryTab
            folio={{ id: "f1", title: "Plan" } as unknown as Folio}
            active
            refreshedAt="2026-09-14T11:00:00.000Z"
            onReverted={async () => {
              fake.reverted++;
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    // The older revision is the one that offers Revert.
    const triggers = await screen.findAllByRole("button", {
      name: "Revision actions",
    });
    expect(triggers).toHaveLength(2);
    fireEvent.click(triggers[1]);
    const revert = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Revert to this",
      );
      if (!found) throw new Error("not open yet");
      return found;
    });
    fireEvent.click(revert);
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getAllByRole("button").at(-1)!);

    const message = "This folio was protected since (spec)";
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(fake.reverts).toBe(1);
    expect(fake.reverted).toBe(0);
  });
});
