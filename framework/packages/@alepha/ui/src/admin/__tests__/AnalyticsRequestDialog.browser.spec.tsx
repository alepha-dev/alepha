import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import { RequestDialog } from "../analytics/RequestDialog.tsx";

/**
 * The Copy button says "Copied" only once the clipboard took the text: with
 * no clipboard (plain http on a non-localhost host) or a refused write,
 * nothing was copied.
 */
describe("RequestDialog copy", () => {
  let alepha: Alepha | undefined;
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  afterEach(async () => {
    cleanup();
    if (original) {
      Object.defineProperty(navigator, "clipboard", original);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
    await alepha?.stop();
    alepha = undefined;
  });

  const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, "clipboard", {
      value,
      configurable: true,
    });

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <RequestDialog
          open
          onOpenChange={() => {}}
          path="/api/admin/analytics/datasets/views/query"
          body={{ select: { count: "sum" } }}
        />
      </AlephaContext.Provider>,
    );
  };

  const copy = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    });
  };

  it("says Copied once the clipboard took the text", async () => {
    let written = "";
    setClipboard({
      writeText: async (text: string) => {
        written = text;
      },
    });
    await mount();
    await copy();
    expect(written).toContain('"count": "sum"');
    expect(screen.getByRole("button", { name: /Copied/ })).toBeTruthy();
  });

  it("does not say Copied when there is no clipboard", async () => {
    setClipboard(undefined);
    await mount();
    await copy();
    expect(screen.queryByRole("button", { name: /Copied/ })).toBeNull();
  });

  it("does not say Copied when the clipboard refuses the write", async () => {
    setClipboard({
      writeText: async () => {
        throw new Error("denied");
      },
    });
    await mount();
    await copy();
    expect(screen.queryByRole("button", { name: /Copied/ })).toBeNull();
  });
});
