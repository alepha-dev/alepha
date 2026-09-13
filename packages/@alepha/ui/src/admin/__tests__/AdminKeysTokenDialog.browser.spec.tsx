import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminKeysTokenDialog } from "../admin-keys-token-dialog.tsx";

/**
 * The dialog is the single moment a freshly minted API key token is readable
 * (the server stores only a hash), so what matters is that the token is
 * actually on screen while set, that nothing renders once cleared, and that
 * both dismissal affordances funnel through `onClose` — a token dialog that
 * cannot close would pin a live credential on screen.
 */
describe("AdminKeysTokenDialog", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (token: string | null, onClose: () => void) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminKeysTokenDialog token={token} onClose={onClose} />
      </AlephaContext.Provider>,
    );
  };

  it("shows the token and the one-time warning while a token is set", async () => {
    await mount("ak_test_1234567890", () => {});

    expect(screen.getByText("ak_test_1234567890")).toBeTruthy();
    expect(screen.getByText(/shown only once/)).toBeTruthy();
    // The copy button is icon-only; the aria-label is its accessible name
    // (and doubles as the tooltip text).
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("renders nothing when token is null", async () => {
    await mount(null, () => {});

    expect(screen.queryByText(/shown only once/)).toBeNull();
  });

  it("calls onClose when Done is pressed", async () => {
    const onClose = vi.fn();
    await mount("ak_test_1234567890", onClose);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
