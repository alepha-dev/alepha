import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../Toaster.tsx";
import {
  type Undoable,
  type UndoableOptions,
  useUndoable,
} from "../useUndoable.tsx";

/**
 * `useUndoable` in both of its modes, against the real toaster.
 *
 * Each test names its toast uniquely: sonner's store is module-level, so a
 * toast one test raised can still be on screen in the next.
 */
describe("useUndoable", () => {
  let alepha: Alepha | undefined;
  let undoable: Undoable | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    // A toast's auto-close timer (6 s) outlives the test: closed here, with
    // its exit animation, so none fires after jsdom is torn down.
    act(() => {
      toast.dismiss();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await alepha?.stop();
    alepha = undefined;
    undoable = undefined;
  });

  /**
   * Hands the hook out from an effect: a render must not write outside
   * itself.
   */
  const Probe = (props: { onReady: (value: Undoable) => void }) => {
    const value = useUndoable();
    useEffect(() => props.onReady(value), [value]);
    return null;
  };

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <Probe
          onReady={(value) => {
            undoable = value;
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(undoable).toBeDefined());
  };

  const toastWith = (text: string) =>
    [...document.querySelectorAll<HTMLElement>("[data-sonner-toast]")].find(
      (it) => it.textContent?.includes(text),
    );

  const buttonIn = (text: string, name: RegExp) =>
    [...(toastWith(text)?.querySelectorAll("button") ?? [])].find(
      (button) =>
        name.test(button.textContent ?? "") ||
        name.test(button.getAttribute("aria-label") ?? ""),
    ) as HTMLElement;

  /**
   * A local "screen" the apply writes, and a log of what reached the server.
   */
  const harness = () => {
    const state = { screen: "before", sent: [] as string[] };
    const options: Omit<UndoableOptions, "message"> = {
      apply: () => {
        state.screen = "after";
        return () => {
          state.screen = "before";
        };
      },
      commit: async () => {
        state.sent.push("commit");
      },
    };
    return { state, options };
  };

  it("sends an invertible write at once, and Undo sends its inverse", async () => {
    await mount();
    const { state, options } = harness();

    let result: unknown;
    await act(async () => {
      result = await undoable!.run({
        ...options,
        message: "Immediate one",
        undo: async () => {
          state.sent.push("undo");
        },
      });
    });
    expect(result).toEqual({ ok: true });
    expect(state.screen).toBe("after");
    expect(state.sent).toEqual(["commit"]);

    await waitFor(() => expect(toastWith("Immediate one")).toBeTruthy());
    fireEvent.click(buttonIn("Immediate one", /undo/i));

    await waitFor(() => expect(state.sent).toEqual(["commit", "undo"]));
    expect(state.screen).toBe("before");
  });

  it("holds a write with no inverse until the toast closes", async () => {
    await mount();
    const { state, options } = harness();

    await act(async () => {
      await undoable!.run({ ...options, message: "Held one" });
    });
    // On screen at once, on the server not yet.
    expect(state.screen).toBe("after");
    expect(state.sent).toEqual([]);

    await waitFor(() => expect(toastWith("Held one")).toBeTruthy());
    fireEvent.click(buttonIn("Held one", /close/i));

    await waitFor(() => expect(state.sent).toEqual(["commit"]));
    expect(state.screen).toBe("after");
  });

  it("never sends a held write that was undone", async () => {
    await mount();
    const { state, options } = harness();

    await act(async () => {
      await undoable!.run({ ...options, message: "Undone one" });
    });
    await waitFor(() => expect(toastWith("Undone one")).toBeTruthy());
    fireEvent.click(buttonIn("Undone one", /undo/i));

    await waitFor(() => expect(state.screen).toBe("before"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.sent).toEqual([]);
  });

  it("rolls back a refused write and reports it once, without rejecting", async () => {
    await mount();
    const { state, options } = harness();
    const reported: string[] = [];
    alepha!.events.on("react:action:error", (event) => {
      reported.push(event.error.message);
    });

    let result: Awaited<ReturnType<Undoable["run"]>> | undefined;
    await act(async () => {
      result = await undoable!.run({
        ...options,
        message: "Refused one",
        commit: async () => {
          throw new Error("refused by the server (spec)");
        },
        undo: async () => {},
      });
    });

    expect(result?.ok).toBe(false);
    expect(state.screen).toBe("before");
    expect(reported).toEqual(["refused by the server (spec)"]);
  });

  it("undoes the newest window on Ctrl+Z, and leaves a text field's own undo alone", async () => {
    await mount();
    const { state, options } = harness();

    await act(async () => {
      await undoable!.run({ ...options, message: "Keyboard one" });
    });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    expect(state.screen).toBe("after");
    input.remove();

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(state.screen).toBe("before"));
    expect(state.sent).toEqual([]);
  });
});
