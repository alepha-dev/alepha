import { Control } from "@alepha/ui/components/control/control";
import { render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows: Row[] = [{ id: 1, title: "Alpha" }];

/**
 * The filter bar fills every field it holds, whatever shape that field is.
 *
 * The bar is `bg-muted` chrome and its fields are `bg-background` wells sunk
 * into it, painted from the bar rather than from the primitives - see the
 * comment on the toolbar in `alepha-table.tsx` for why it is scoped there and
 * why the `dark:` copy is not redundant.
 *
 * ⚠️ **Asserted through the bar's OWN selector, read off its class, rather
 * than against a colour or a copy of the selector.** jsdom loads no Tailwind,
 * so there is no computed fill here to compare; and a spec that hardcoded
 * `[data-slot=date-trigger]` would pass by agreeing with itself. Lifting the
 * selector out of the rendered class asks the only question that matters: does
 * the rule the bar actually carries reach this control?
 *
 * The bug it guards (#Q2295): the selector read `:is(input,[role=combobox])`,
 * the two shapes a field happened to have when it was written. A calendar
 * opens a POPOVER, so its trigger is a plain button with no combobox role, and
 * it silently kept the primitives' own `dark:bg-input/30` - a translucent
 * white wash sitting LIGHTER than the bar while every select beside it sat
 * darker. #Q2282 and #Q2283 had already put the date controls on the kit's
 * trigger, so the box and the border matched and only the fill gave it away.
 */
describe("AlephaTable (filter bar fill)", () => {
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
   * The bar's fill rule, as a plain CSS selector.
   *
   * Tailwind spells an arbitrary variant `[&_<selector>]:bg-background`, and
   * the bar carries it twice - once bare and once under `dark:`. Both name the
   * same selector, so the first token answers for both. Split on whitespace
   * first: the selector itself contains `[...]` and `(...)`, which no regexp
   * over the whole class string can be trusted to balance.
   */
  const fillSelector = (bar: Element): string => {
    const token = bar.className
      .split(/\s+/)
      .find((c) => c.startsWith("[&_") && c.endsWith("]:bg-background"));
    if (!token)
      throw new Error(`no fill rule on the filter bar: ${bar.className}`);
    return token.slice("[&_".length, -"]:bg-background".length);
  };

  it("reaches a date trigger, not only inputs and comboboxes", async () => {
    const { container } = await mount(
      <AlephaTable<Row>
        data={rows}
        columns={columns}
        filters={{
          schema: z.object({
            createdAt: z.dateRange().optional(),
            status: z.enum(["open", "closed"]).optional(),
          }),
          render: (form) => (
            <>
              <Control
                input={form.input.createdAt}
                label=""
                placeholder="Any date"
              />
              <Control
                input={form.input.status}
                label=""
                items={[
                  { value: "open", label: "Open" },
                  { value: "closed", label: "Closed" },
                ]}
              />
            </>
          ),
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    const bar = container.querySelector(".bg-muted");
    expect(bar).toBeTruthy();

    const filled = [...bar!.querySelectorAll(fillSelector(bar!))];
    const date = bar!.querySelector('[data-slot="date-trigger"]');
    const select = bar!.querySelector('[data-slot="combobox-trigger"]');

    // Both are rendered, so a miss below is the rule and not the fixture.
    expect(date).toBeTruthy();
    expect(select).toBeTruthy();

    expect(filled).toContain(select);
    expect(filled).toContain(date);
  });
});
