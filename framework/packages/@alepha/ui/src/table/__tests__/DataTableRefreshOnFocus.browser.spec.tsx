import { act, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * `refreshOnFocus` (#Q4069): a background reload when the tab becomes
 * visible again, unless the rows were read a moment ago.
 */
describe("DataTable refreshOnFocus", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  const mount = async (
    refreshOnFocus: boolean,
    cols: typeof columns | Record<string, any> = columns,
  ) => {
    alepha = Alepha.create()
      .with(AlephaDateTime)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    let calls = 0;
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          columns={cols}
          refreshOnFocus={refreshOnFocus}
          fetch={async () => {
            calls++;
            return {
              content: [{ id: 1, title: `Load ${calls}` }],
              page: { number: 0, size: 20, totalElements: 1 },
            } as any;
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(calls).toBe(1));
    return { clock, calls: () => calls };
  };

  it("reloads once when the tab comes back after a while, keeping the rows on screen", async () => {
    const { clock, calls } = await mount(true);

    setHidden(true);
    await clock.travel(60_000);
    setHidden(false);

    await waitFor(() => expect(screen.getByText("Load 2")).toBeTruthy());
    expect(calls()).toBe(2);
  });

  it("sends nothing when the rows were read a moment ago", async () => {
    const { calls } = await mount(true);

    setHidden(true);
    setHidden(false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls()).toBe(1);
  });

  it("is off by default", async () => {
    const { clock, calls } = await mount(false);

    setHidden(true);
    await clock.travel(60_000);
    setHidden(false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls()).toBe(1);
  });

  it("never reloads under an edit: a field inside the table has focus", async () => {
    const { clock, calls } = await mount(true, {
      title: {
        label: "Title",
        cell: (r: Row) => (
          <input aria-label="Edit title" defaultValue={r.title} />
        ),
      },
    });
    (screen.getByLabelText("Edit title") as HTMLInputElement).focus();

    setHidden(true);
    await clock.travel(60_000);
    setHidden(false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls()).toBe(1);
  });
});
