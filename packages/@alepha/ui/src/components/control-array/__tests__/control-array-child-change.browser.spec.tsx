import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AutoForm } from "../../auto-form/auto-form.tsx";

/**
 * `ControlArray` builds an input of its own for each item and each item field,
 * with a path of its own (`.../1/name`), but wrote through `input.set()` —
 * which sets the ARRAY and makes `FormModel` emit `form:change` for the
 * array's path alone.
 *
 * So a child subscribed through `useFieldValue` never heard about its own
 * edit. It kept rendering the value it had at mount, and the moment anything
 * forced a re-render — removing a sibling, adding a row — the typed value
 * snapped back.
 */
describe("ControlArray child changes", () => {
  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const schema = z.object({
    items: z.array(z.object({ name: z.text() })),
  });

  const Probe = () => {
    const form = useForm({
      schema,
      initialValues: { items: [{ name: "one" }, { name: "two" }] },
      handler: () => {},
    });
    return <AutoForm form={form} fields={{ items: { label: "Items" } }} />;
  };

  /**
   * Every text box `ControlArray` rendered for the item field, in row order.
   */
  const nameInputs = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    );

  it("keeps a typed value when a sibling is removed", async () => {
    const alepha = await start();
    const { container } = mount(alepha, <Probe />);

    await waitFor(() => expect(nameInputs(container)).toHaveLength(2));

    const second = nameInputs(container)[1];
    fireEvent.change(second, { target: { value: "edited" } });
    await waitFor(() => expect(second.value).toBe("edited"));

    // Remove the FIRST row: the edited row moves from index 1 to index 0, so
    // its path changes and it re-renders.
    const remove = screen.getAllByRole("button", { name: /remove|delete/i });
    fireEvent.click(remove[0]);

    await waitFor(() => expect(nameInputs(container)).toHaveLength(1));
    expect(nameInputs(container)[0].value).toBe("edited");
  });

  it("keeps a typed value when a row is appended", async () => {
    const alepha = await start();
    const { container } = mount(alepha, <Probe />);

    await waitFor(() => expect(nameInputs(container)).toHaveLength(2));

    const second = nameInputs(container)[1];
    fireEvent.change(second, { target: { value: "edited" } });
    await waitFor(() => expect(second.value).toBe("edited"));

    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => expect(nameInputs(container)).toHaveLength(3));
    expect(nameInputs(container)[1].value).toBe("edited");
  });
});
