import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccountMfaDialog } from "../AccountMfaDialog.tsx";
import { AccountRecoveryCodesDialog } from "../AccountRecoveryCodesDialog.tsx";

const CODES = ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"];

/**
 * Answers `enrollTotp` and `activateTotp`. Substitution rather than
 * `vi.mock`, per `CLAUDE.md`.
 */
class MfaLinkProvider extends LinkProvider {
  override client(): any {
    const answers: Record<string, unknown> = {
      enrollTotp: { secret: "S", uri: "otpauth://x", qrSvg: "<svg></svg>" },
      activateTotp: { recoveryCodes: CODES },
    };
    return new Proxy(
      {},
      {
        get: (_target, prop: string) =>
          Object.assign(async () => answers[prop] ?? {}, { can: () => true }),
      },
    );
  }
}

/**
 * #Q2518: every close path of the enrollment dialog cleared the recovery
 * codes, and nothing blocked Escape, a backdrop click or the X, although the
 * codes can never be shown again. They close only on "I have saved them".
 */
describe("recovery codes cannot be dismissed by accident", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const start = async () => {
    alepha = Alepha.create()
      .with({ provide: LinkProvider, use: MfaLinkProvider })
      .with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const pressEscape = () =>
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

  it("keeps the enrollment's codes on screen through Escape and a backdrop click", async () => {
    const app = await start();
    const changes: boolean[] = [];
    render(
      <AlephaContext.Provider value={app}>
        <AccountMfaDialog open onOpenChange={(open) => changes.push(open)} />
      </AlephaContext.Provider>,
    );

    // Type the code, which activates and reveals the codes.
    await waitFor(() => expect(screen.getByText("Turn on")).toBeTruthy());
    const input = document.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    await waitFor(() =>
      expect(screen.getByTestId("recovery-codes").textContent).toContain(
        "aaaa-1111",
      ),
    );

    // No close button while the codes are shown.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    pressEscape();
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
    if (backdrop) fireEvent.click(backdrop);

    expect(changes).not.toContain(false);
    expect(screen.getByTestId("recovery-codes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "I have saved them" }));
    expect(changes).toContain(false);
  });

  it("keeps regenerated codes open until they are saved", async () => {
    const app = await start();
    let closed = 0;
    render(
      <AlephaContext.Provider value={app}>
        <AccountRecoveryCodesDialog codes={CODES} onClose={() => closed++} />
      </AlephaContext.Provider>,
    );

    expect(screen.getByTestId("recovery-codes").textContent).toContain(
      "dddd-4444",
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    pressEscape();
    expect(closed).toBe(0);
    expect(screen.getByTestId("recovery-codes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "I have saved them" }));
    expect(closed).toBe(1);
  });
});
