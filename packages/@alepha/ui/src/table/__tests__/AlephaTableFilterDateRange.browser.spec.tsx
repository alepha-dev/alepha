import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// ⚠️ The calendar is a lazy chunk (`LazyCalendar`), so nothing the bar imports
// loads it. Imported here, with the file, it is in the module cache before the
// first popover opens: the cases then wait on the bar, not on a cold import of
// react-day-picker, which under a loaded `yarn v` outran a five-second
// `waitFor` (#Q2185, #F1310). Never widen a timeout to absorb it instead.
import { Calendar } from "../../calendar/Calendar.tsx";
import { AlephaTable } from "../AlephaTable.tsx";
import type { AlephaTableFilterFields } from "../alephaTableTypes.ts";

void Calendar;

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const pageOf = (rows: Row[]) => ({
  content: rows,
  page: {
    number: 0,
    size: 20,
    offset: 0,
    numberOfElements: rows.length,
    totalElements: rows.length,
    totalPages: 1,
    isEmpty: rows.length === 0,
    isFirst: true,
    isLast: true,
  },
});

const filterFields = {
  search: { preset: "search" },
  createdAt: { schema: z.dateRange(), label: "Created" },
} satisfies AlephaTableFilterFields;

class App {
  list = $page({
    path: "/list",
    component: () => <div>list</div>,
  });
}

/**
 * A `z.dateRange()` field on the bar (#E58, #Q2315).
 *
 * `Control` already draws a range picker for one; what the bar assumed of a
 * control, a range did not do: be classified by the add menu, carry the
 * filter's name on its trigger, lose its frame inside the bar's box, and open
 * when added. Each case below is one of those.
 */
describe("AlephaTable (a date range on the filter bar)", () => {
  let alepha: Alepha | undefined;
  let copied: string[] = [];

  beforeAll(() => {
    setupJsdomMocks();
    // jsdom ships no clipboard. Defined rather than spied on, per the repo's
    // no-`vi.mock` rule: a missing browser API, not a seam.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    copied = [];
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  const mount = async (
    url = "/list",
    options: { seedValues?: { createdAt?: string[] } } = {},
  ) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push(url);
    });
    const seen: Array<Record<string, any> | undefined> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <AlephaTable<Row, typeof filterFields>
          columns={columns}
          filters={{
            fields: filterFields,
            fromQuery: true,
            seedValues: options.seedValues,
          }}
          fetch={async ({ filters }) => {
            seen.push(filters);
            return pageOf([{ id: 1, title: "Alpha" }]);
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return { seen };
  };

  const slot = () =>
    document.querySelector('[data-filter="createdAt"]') as HTMLElement | null;

  const trigger = () =>
    slot()?.querySelector('[data-slot="date-trigger"]') as HTMLElement | null;

  /**
   * The day BUTTONS, re-queried on every call: a click re-renders the
   * calendar, and a button captured before it is a detached node.
   */
  const days = async () =>
    await waitFor(() => {
      const found = [
        ...document.querySelectorAll('[role="gridcell"] button'),
      ] as HTMLElement[];
      expect(found.length).toBeGreaterThan(1);
      return found;
    });

  const addCreated = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Add filter" }), {
      key: "ArrowDown",
    });
    const menu = await screen.findByRole("menu");
    const item = within(menu).getByRole("menuitem", { name: /^Created/ });
    return { item, click: () => fireEvent.click(item) };
  };

  it("is offered as a date in the add menu, not as a list", async () => {
    await mount();

    const { item } = await addCreated();

    // A range IS an array, so classified as one it would read "list" and
    // open a calendar.
    expect(item.textContent).toBe("Createddate");
  });

  it("opens its calendar when added", async () => {
    await mount();

    const { click } = await addCreated();
    click();

    await waitFor(() => expect(slot()).toBeTruthy());
    expect((await days()).length).toBeGreaterThan(1);
  });

  it("names the filter on the trigger once a range is picked", async () => {
    await mount();
    const { click } = await addCreated();
    click();

    fireEvent.click((await days())[3]!);
    fireEvent.click((await days())[9]!);

    await waitFor(() =>
      expect(trigger()?.textContent?.startsWith("Created ")).toBe(true),
    );
    // Muted, in the same run as the range, like "Status Active".
    const prefix = trigger()?.querySelector(
      ".truncate > .text-muted-foreground",
    );
    expect(prefix?.textContent?.trim()).toBe("Created");
  });

  it("draws no prefix on an empty range, whose placeholder names it", async () => {
    await mount();
    const { click } = await addCreated();
    click();

    await waitFor(() => expect(trigger()).toBeTruthy());
    expect(trigger()?.textContent).not.toContain("Created ");
  });

  it("strips the trigger's own frame inside the bar's box", async () => {
    await mount("/list", {
      seedValues: { createdAt: ["2026-01-01", "2026-01-31"] },
    });
    await waitFor(() => expect(slot()).toBeTruthy());

    // jsdom loads no Tailwind, so the rule is read off the container's class
    // rather than off a computed style: does the box carry a rule reaching
    // the date trigger's border?
    const box = slot()!.firstElementChild as HTMLElement;
    expect(box.className).toContain("[&_[data-slot=date-trigger]]:border-0");
  });

  it("clears with the cross first, then removes with the funnel", async () => {
    const { seen } = await mount("/list", {
      seedValues: { createdAt: ["2026-01-01", "2026-01-31"] },
    });
    await waitFor(() => expect(slot()).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", { name: "Clear value: Created" }),
    );
    await waitFor(() =>
      expect(seen.at(-1)?.createdAt === undefined).toBe(true),
    );
    expect(slot()).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter: Created" }),
    );
    await waitFor(() => expect(slot()).toBeNull());
  });

  it("seeds from a comma-joined link and shares it back in the same form", async () => {
    const { seen } = await mount("/list?createdAt=2026-01-01,2026-01-31");

    await waitFor(() => expect(slot()).toBeTruthy());
    expect(seen[0]?.createdAt).toEqual(["2026-01-01", "2026-01-31"]);

    fireEvent.keyDown(screen.getByRole("button", { name: "Filters" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Share/ }));

    await waitFor(() => expect(copied.length).toBe(1));
    expect(copied[0]).toBe(
      `${window.location.origin}/list?createdAt=2026-01-01,2026-01-31`,
    );
  });
});
