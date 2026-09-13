import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { type BaseInputField, useFieldValue, useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ControlSelect } from "../control-select.tsx";

/**
 * Multi-select used to render a bordered chips box instead of a trigger: a
 * different-looking control for the same job, one that grew with every pick
 * and then truncated, and one that forced a search field on because the chips
 * input was the only way to open the popup.
 *
 * It is the same button trigger as single-select now, labelled "value, then
 * count" — one selection names itself, two or more collapse. Nothing covered
 * any of this before, which is exactly how the chips box survived so long.
 */
describe("ControlSelect multi", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const STATUSES = [
    { value: "new", label: "New" },
    { value: "accepted", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "shelved", label: "Shelved" },
  ];

  const LONG = Array.from({ length: 60 }, (_, i) => `opt-${i}`);

  const Probe = (props: {
    items?: (typeof STATUSES)[number][] | string[];
    countLabel?: (n: number) => string;
    createNewEntry?: boolean;
  }) => {
    const form = useForm({
      // An ARRAY field is the whole multi-select API — there is no `multi` prop.
      schema: z.object({ status: z.array(z.text()).optional() as never }),
      handler: () => {},
    });
    return (
      <>
        <ControlSelect
          input={form.input.status}
          label="Status"
          clearable
          clearLabel="All status"
          countLabel={props.countLabel}
          createNewEntry={props.createNewEntry}
          items={(props.items ?? STATUSES) as never}
        />
        <Reporter input={form.input.status} />
      </>
    );
  };

  /**
   * The server-mode half: a real async loader, above the threshold, so the
   * component is in long mode and its list is whatever the last query
   * returned.
   *
   * The loader answers a query with its matches and an EMPTY query with a
   * first page - which is what an autocomplete does, and what makes a value
   * found by searching disappear from the list the moment the query is
   * cleared.
   */
  const ServerProbe = () => {
    const form = useForm({
      schema: z.object({ status: z.array(z.text()).optional() as never }),
      handler: () => {},
    });
    return (
      <>
        <ControlSelect
          input={form.input.status}
          label="Status"
          clearable
          clearLabel="All status"
          loaderThreshold={0}
          loaderDebounce={0}
          loader={async (q: string) =>
            q
              ? ["alpha", "beta", "gamma", "delta"].filter((i) => i.includes(q))
              : ["alpha", "beta"]
          }
        />
        <Reporter input={form.input.status} />
      </>
    );
  };

  const Reporter = (props: { input: BaseInputField }) => {
    const [value] = useFieldValue(props.input);
    return (
      <span data-testid="value">
        {Array.isArray(value) && value.length ? value.join(",") : "∅"}
      </span>
    );
  };

  /**
   * ⚠️ The BUTTON, picked out of the two elements carrying `role="combobox"`.
   *
   * The popup's search field is the other one, so a bare `getByRole` throws
   * "found multiple elements" for any case that reads the trigger while an
   * open popup has a search field - which is every list with
   * `createNewEntry`, a server loader, or more rows than the threshold.
   */
  const trigger = (ui: ReturnType<typeof render>) =>
    ui.getAllByRole("combobox").find((el) => el.tagName === "BUTTON")!;
  const openPopup = (ui: ReturnType<typeof render>) =>
    fireEvent.keyDown(trigger(ui), { key: "ArrowDown" });

  it("renders one button trigger, not a chips box", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    // The chips box was a div with a nested text input; the trigger is a
    // button. Its absence is what proves the shape changed.
    expect(trigger(ui).tagName).toBe("BUTTON");
  });

  it("shows the placeholder while empty", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    expect(trigger(ui).textContent).toContain("All status");
  });

  it("omits the search field on a short list", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    await ui.findByRole("option", { name: /In progress/ });
    // Multi used to force this on unconditionally.
    expect(ui.queryByPlaceholderText("Search…")).toBeNull();
  });

  it("adds the search field above the threshold", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe items={LONG} />);

    openPopup(ui);
    await ui.findByRole("option", { name: "opt-0" });
    expect(ui.queryByPlaceholderText("Search…")).not.toBeNull();
  });

  it("adds the search field when entries can be created", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe createNewEntry />);

    openPopup(ui);
    await ui.findByRole("option", { name: /In progress/ });
    // Typing IS how a new entry is made, so a short list still gets one.
    expect(ui.queryByPlaceholderText("Search…")).not.toBeNull();
  });

  it("offers no clear row — a multi clears by deselecting", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    await ui.findByRole("option", { name: /In progress/ });
    expect(ui.queryByRole("option", { name: "All status" })).toBeNull();
  });

  it("names the value at one selection, and counts past that", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted");
    });
    // One selection reads as the value — the commonest case, and the reason
    // a bare count everywhere would have been worse than chips.
    expect(trigger(ui).textContent).toContain("In progress");

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /Completed/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted,completed");
    });
    expect(trigger(ui).textContent).toContain("2 selected");
    // The collapse is the point: the label must stop naming values so the
    // trigger keeps a fixed width.
    expect(trigger(ui).textContent).not.toContain("In progress");
  });

  it("honors a caller's countLabel", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe countLabel={(n) => `${n} status`} />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted");
    });
    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /Completed/ }));

    await waitFor(() => {
      expect(trigger(ui).textContent).toContain("2 status");
    });
  });

  it("deselects a chosen row and falls back to the placeholder", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted");
    });

    // Removing the last value was the chips' X button; with the chips gone,
    // pressing the selected row has to be the way back to empty.
    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("∅");
    });
    expect(trigger(ui).textContent).toContain("All status");
  });
  /*
    Feedback #2115: on the showcase's `Tags (multi + create)` field, selecting
    A and B then creating C left the trigger reading "3 selected" while the
    popup listed four options with two check marks. C was selected, counted,
    and invisible - so it could not be deselected from the list it was
    missing from.

    The component built its list strictly from `props.data`, so a selected
    value that is not in `data` had no row. It was already half-aware of
    this: `labelCache` exists for exactly these values and its own comment
    names both ways in - a freshly created entry, and one a server-filtered
    `data` set has dropped. The LABEL problem was solved and the LIST problem
    was not.

    ⚠️ The caller cannot fix this one. The showcase declares its items as a
    static literal inside a zod `.meta({ $control })`, with no caller state to
    append to, and `useForm` anchors its schema at mount anyway - which is the
    normal declarative way controls are written here. `createNewEntry` was
    broken by construction for every such caller.
  */
  describe("a selected value with no option to be selected from", () => {
    const selectedRows = (ui: ReturnType<typeof render>) =>
      ui.getAllByRole("option").filter((o) => o.ariaSelected === "true");

    const type = (ui: ReturnType<typeof render>, text: string) =>
      fireEvent.change(ui.getByPlaceholderText("Search…"), {
        target: { value: text },
      });

    it("gives a created value a row, and the check marks match the count", async () => {
      const alepha = await start();
      const ui = mount(alepha, <Probe createNewEntry />);

      openPopup(ui);
      fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
      openPopup(ui);
      fireEvent.click(await ui.findByRole("option", { name: /Completed/ }));

      openPopup(ui);
      type(ui, "urgent");
      fireEvent.click(await ui.findByRole("option", { name: /urgent/ }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe(
          "accepted,completed,urgent",
        );
      });

      // The report, exactly: the trigger says three and the list has to agree.
      expect(trigger(ui).textContent).toContain("3 selected");
      openPopup(ui);
      await waitFor(() => {
        expect(selectedRows(ui)).toHaveLength(3);
      });
    });

    it("lets a created value be deselected from the list it now appears in", async () => {
      const alepha = await start();
      const ui = mount(alepha, <Probe createNewEntry />);

      openPopup(ui);
      type(ui, "urgent");
      fireEvent.click(await ui.findByRole("option", { name: /urgent/ }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe("urgent");
      });

      openPopup(ui);
      // With the query cleared, the created value is a row like any other.
      fireEvent.click(await ui.findByRole("option", { name: "urgent" }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe("∅");
      });
    });

    /**
     * The bonus the injection point buys: `showCreate`'s guard reads
     * `options`, so putting the orphans there rather than in `filtered` stops
     * a second Create row being offered for a value that already exists.
     */
    it("stops offering Create for a value it has already created", async () => {
      const alepha = await start();
      const ui = mount(alepha, <Probe createNewEntry />);

      openPopup(ui);
      type(ui, "urgent");
      fireEvent.click(await ui.findByRole("option", { name: /urgent/ }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe("urgent");
      });

      openPopup(ui);
      type(ui, "urgent");
      await waitFor(() => {
        expect(ui.getAllByRole("option", { name: /urgent/ })).toHaveLength(1);
      });
      // One row, and it is the real value rather than an offer to make it
      // again.
      expect(selectedRows(ui)).toHaveLength(1);
    });

    /**
     * ⚠️ The DECISION, pinned so it stays one: an orphan is filtered by the
     * typed query like every other row. A search that kept showing rows it
     * did not match would stop being a search.
     */
    it("hides a created value under a query that does not match it", async () => {
      const alepha = await start();
      const ui = mount(alepha, <Probe createNewEntry />);

      openPopup(ui);
      type(ui, "urgent");
      fireEvent.click(await ui.findByRole("option", { name: /urgent/ }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe("urgent");
      });

      openPopup(ui);
      type(ui, "prog");
      await waitFor(() => {
        expect(ui.queryByRole("option", { name: "urgent" })).toBeNull();
      });
      expect(ui.getByRole("option", { name: /In progress/ })).not.toBeNull();
    });

    /**
     * The second door, and the one `labelCache`'s comment already named: a
     * server-filtered list drops the picked value, so its row goes while the
     * trigger keeps counting it. Driven through a real async loader in long
     * mode rather than by shrinking a static array, because the disappearance
     * has to come from the same place it does in production.
     */
    it("gives a server-dropped value a row once the query is cleared", async () => {
      const alepha = await start();
      const ui = mount(alepha, <ServerProbe />);

      openPopup(ui);
      await ui.findByRole("option", { name: "alpha" });
      type(ui, "gamma");
      fireEvent.click(await ui.findByRole("option", { name: "gamma" }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe("gamma");
      });

      // Back to the first page, which does not contain gamma. Before the fix
      // the trigger said "gamma" and the list showed alpha and beta only.
      openPopup(ui);
      type(ui, "");
      await waitFor(() => {
        expect(ui.getByRole("option", { name: "alpha" })).not.toBeNull();
      });
      expect(ui.getByRole("option", { name: "gamma" })).not.toBeNull();
      expect(selectedRows(ui)).toHaveLength(1);

      fireEvent.click(ui.getByRole("option", { name: "gamma" }));
      await waitFor(() => {
        expect(ui.getByTestId("value").textContent).toBe("∅");
      });
    });
  });
});
