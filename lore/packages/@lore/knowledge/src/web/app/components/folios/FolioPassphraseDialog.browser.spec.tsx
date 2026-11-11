import { Toaster } from "@alepha/ui";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import FolioPassphraseDialog from "./FolioPassphraseDialog.tsx";

/**
 * The folio passphrase dialog, encrypt and unlock: password fields with the
 * eye toggle (#Q3422), and a refusal as an error toast with the dialog still
 * open (#Q3421).
 */
describe("FolioPassphraseDialog", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: {
    requireConfirm?: boolean;
    onSubmit?: (passphrase: string) => Promise<string | null>;
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const submitted: string[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <Toaster />
        <FolioPassphraseDialog
          open
          onOpenChange={() => {}}
          title="Encrypt"
          submitLabel="Encrypt"
          requireConfirm={props.requireConfirm}
          onSubmit={
            props.onSubmit ??
            (async (passphrase) => {
              submitted.push(passphrase);
              return null;
            })
          }
        />
      </AlephaContext.Provider>,
    );
    return { submitted };
  };

  const fill = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), {
      target: { value },
    });

  it("draws its passphrase fields with the show/hide toggle", async () => {
    await mount({ requireConfirm: true });

    expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(
      2,
    );
  });

  it("toasts a mismatch and keeps the dialog open, calling nothing", async () => {
    const { submitted } = await mount({ requireConfirm: true });

    fill(/^passphrase\*?$/i, "correct horse battery");
    fill(/confirm passphrase/i, "correct horse battery staple");
    const button = screen.getByRole("button", { name: "Encrypt" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);

    expect(await screen.findByText("Passphrases don't match.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(submitted).toEqual([]);
  });

  it("toasts the error an unlock returns", async () => {
    await mount({ onSubmit: async () => "Wrong passphrase." });

    fill(/^passphrase\*?$/i, "not it");
    const button = screen.getByRole("button", { name: "Encrypt" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);

    expect(await screen.findByText("Wrong passphrase.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });
});
