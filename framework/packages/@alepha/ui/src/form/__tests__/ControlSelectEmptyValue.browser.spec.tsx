import { fireEvent, render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, expect, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * An empty string is no selection. A text field a form seeds with `""` used
 * to count it as a picked value with no option to pick it from: the popup
 * grew a blank row, the trigger lost its muted placeholder style, and a
 * `clearable` field offered to clear nothing.
 */
describe("ControlSelect and an empty-string value", () => {
  const Probe = (props: { items: string[]; multi?: boolean }) => {
    const form = useForm({
      schema: z.object({
        s: z.string().optional(),
        m: z.array(z.string()).optional(),
      }),
      initialValues: { s: "", m: [""] },
      handler: () => {},
    });
    return (
      <Control
        input={props.multi ? form.input.m : form.input.s}
        items={props.items}
        clearable
      />
    );
  };

  const mount = async (items: string[], multi?: boolean) => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Probe items={items} multi={multi} />
      </AlephaContext.Provider>,
    );
  };

  it.each([
    ["single", false],
    ["multi", true],
  ])("reads as nothing selected (%s)", async (_, multi) => {
    const ui = await mount(["a", "b"], multi);

    const trigger = ui.getByRole("combobox");
    expect(trigger.className).toContain("text-muted-foreground");
    expect(document.querySelector('[data-slot="control-clear"]')).toBeNull();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const rows = await ui.findAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual(["a", "b"]);
  });
});
