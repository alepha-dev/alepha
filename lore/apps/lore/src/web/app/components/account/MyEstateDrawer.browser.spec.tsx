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
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { OwnedEstateResource } from "@/api/schemas/ownedEstateResourceSchema.ts";

import { I18n } from "../../services/I18n.ts";
import MyEstateDrawer from "./MyEstateDrawer.tsx";

/**
 * Refuses `rotateEstate`; answers everything else with an empty result.
 */
class FakeLinkProvider extends LinkProvider {
  rotations = 0;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = (fn: (...args: any[]) => Promise<unknown>) =>
      Object.assign(fn, { can: () => true });
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, prop: string) =>
        prop === "rotateEstate"
          ? action(async () => {
              this.rotations++;
              throw new Error("Estate is locked for rotation (spec)");
            })
          : action(async () => ({ items: [] })),
    });
  }
}

const ESTATE = {
  id: "0199a0f0-0000-7000-8000-00000000e57a",
  type: "bay",
  slug: "home-lab",
  label: "Home lab",
  secretPrefix: "bay_ab",
  online: false,
  deployAllowed: true,
  collectSeries: false,
  statsIntervalSeconds: 900,
  projects: [],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
} as unknown as OwnedEstateResource;

/**
 * The estate drawer's writes, on `useAction` (#E59, #Q2325). A refused
 * rotation used to be caught and toasted by a local `fail`; the root listener
 * shows it now, once, and the drawer is not told of a secret that was never
 * minted.
 */
describe("MyEstateDrawer", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("toasts a refused rotation exactly once, after the confirmation", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const fake = alepha.inject(FakeLinkProvider);
    const secrets: string[] = [];

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <MyEstateDrawer
            estate={ESTATE}
            onOpenChange={() => {}}
            onChanged={() => {}}
            onDeleted={() => {}}
            onSecret={(secret) => secrets.push(secret)}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    fireEvent.click(await screen.findByTestId("my-estate-rotate"));
    const dialog = await screen.findByRole("alertdialog");
    expect(fake.rotations).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }));

    await waitFor(() =>
      expect(
        screen.getAllByText("Estate is locked for rotation (spec)"),
      ).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      screen.getAllByText("Estate is locked for rotation (spec)"),
    ).toHaveLength(1);
    expect(fake.rotations).toBe(1);
    expect(secrets).toEqual([]);
  });
});
