import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

/** No `id`, on purpose: this is the case that fell back to `Math.random()`. */
interface Row {
  title: string;
}

/**
 * Rows without an `id` used to be keyed with `Math.random()`, so every render
 * produced a new key and React remounted the row. Anything living in that row
 * - focus, an uncommitted input value, a selection - was destroyed by a
 * re-render caused somewhere else entirely.
 */
describe("AlephaTable row keys without an id", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  /**
   * A table with an inline input, plus a counter outside it whose only job is
   * to force a re-render of the whole tree without touching `data`.
   */
  const Harness = () => {
    const [tick, setTick] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          rerender
        </button>
        <span data-testid="tick">{tick}</span>
        <AlephaTable<Row>
          data={[{ title: "Alpha" }, { title: "Beta" }]}
          columns={{
            title: {
              label: "Title",
              cell: (r: Row) => (
                <input aria-label={`edit ${r.title}`} defaultValue={r.title} />
              ),
            },
          }}
        />
      </>
    );
  };

  it("keeps focus in an inline input across an unrelated re-render", async () => {
    await mount(<Harness />);

    const input = await screen.findByLabelText("edit Alpha");
    (input as HTMLInputElement).focus();
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    await waitFor(() =>
      expect(screen.getByTestId("tick").textContent).toBe("1"),
    );

    // Same element, still focused. A remount would have replaced the node,
    // dropping focus to <body>.
    expect(screen.getByLabelText("edit Alpha")).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("keeps an uncommitted edit across an unrelated re-render", async () => {
    await mount(<Harness />);

    const input = (await screen.findByLabelText(
      "edit Beta",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Beta (editing)" } });

    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    await waitFor(() =>
      expect(screen.getByTestId("tick").textContent).toBe("1"),
    );

    // `defaultValue` means a remount would reset this to "Beta".
    expect((screen.getByLabelText("edit Beta") as HTMLInputElement).value).toBe(
      "Beta (editing)",
    );
  });
});
