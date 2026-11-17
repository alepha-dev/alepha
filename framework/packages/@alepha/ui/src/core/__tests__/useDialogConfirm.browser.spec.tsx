import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider, useDialog } from "../useDialog.tsx";

/**
 * `confirm({ onConfirm })` runs in the confirm button's own click (#Q3583):
 * a clipboard write after `await dialog.confirm(...)` is outside the gesture,
 * which Safari refuses.
 */
describe("useDialog confirm onConfirm", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (onConfirm: () => void, results: boolean[]) => {
    const Opener = () => {
      const dialog = useDialog();
      return (
        <button
          type="button"
          onClick={async () => {
            results.push(await dialog.confirm({ title: "Go?", onConfirm }));
          }}
        >
          open
        </button>
      );
    };
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Opener />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("calls onConfirm synchronously in the confirm click, before resolving", async () => {
    const calls: string[] = [];
    const results: boolean[] = [];
    await mount(() => calls.push("confirmed"), results);

    fireEvent.click(screen.getByText("open"));
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);

    // Already called when the click returns: no microtask in between.
    expect(calls).toEqual(["confirmed"]);
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("does not call onConfirm on cancel", async () => {
    const calls: string[] = [];
    const results: boolean[] = [];
    await mount(() => calls.push("confirmed"), results);

    fireEvent.click(screen.getByText("open"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(results).toEqual([false]));
    expect(calls).toEqual([]);
  });
});

/**
 * `confirm({ confirmText })` (#Q3819): the confirm button stays disabled
 * until the user types the text, through a labelled field that Enter submits.
 */
describe("useDialog confirm confirmText", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (results: boolean[]) => {
    const Opener = () => {
      const dialog = useDialog();
      return (
        <button
          type="button"
          onClick={async () => {
            results.push(
              await dialog.confirm({
                title: "Open the project?",
                confirmText: "acme",
              }),
            );
          }}
        >
          open
        </button>
      );
    };
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Opener />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("enables confirm only once the text is typed", async () => {
    const results: boolean[] = [];
    await mount(results);

    fireEvent.click(screen.getByText("open"));
    // The field is named by its label, so a screen reader announces it.
    const field = await screen.findByLabelText("Type acme to confirm");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: "acm" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    // Enter does not get around the disabled button.
    fireEvent.keyDown(field, { key: "Enter" });
    expect(results).toEqual([]);

    fireEvent.change(field, { target: { value: "acme" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("starts empty again on the next open", async () => {
    const results: boolean[] = [];
    await mount(results);

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(await screen.findByLabelText("Type acme to confirm"), {
      target: { value: "acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(results).toEqual([false]));

    fireEvent.click(screen.getByText("open"));
    const field = await screen.findByLabelText("Type acme to confirm");
    expect((field as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
