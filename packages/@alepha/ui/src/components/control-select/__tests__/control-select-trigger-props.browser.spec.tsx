import { render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { Control } from "../../control/control.tsx";

/**
 * `Control`'s `inputProps` has to reach a select-shaped field's trigger.
 *
 * It used not to: the select branch forwarded `label`, `icon`, `clearable`
 * and `triggerClassName` and dropped `inputProps` on the floor. That is
 * silent in every way that matters, because the prop is accepted, typechecks,
 * and simply does nothing — so `inputProps={{ "aria-label": … }}` on the
 * epics and quests status filters named nothing at all for as long as it has
 * been written there.
 *
 * A filter is routinely rendered with `label=""` beside its own heading, and
 * then the trigger is a button with no `<label>` to borrow a name from. With
 * `inputProps` dropped it has no accessible name whatsoever: unreachable by
 * assistive tech, and unaddressable by `getByRole("combobox", { name })`,
 * which is how the admin analytics e2e finds its dataset picker.
 *
 * Asserted through `Control` rather than `ControlSelect`, because the gap was
 * in the hand-off between the two and a test on the inner component would
 * have passed throughout.
 */
describe("Control inputProps on a select", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const Probe = (props: { multi?: boolean; count?: number }) => {
    const form = useForm({
      schema: z.object({
        tag: props.multi
          ? (z.array(z.text()).optional() as never)
          : (z.text().optional() as never),
      }),
      handler: () => {},
    });
    return (
      <Control
        input={form.input.tag}
        label=""
        items={Array.from(
          { length: props.count ?? 5 },
          (_, index) => `tag-${index}`,
        )}
        inputProps={{ "aria-label": "Pick a tag" }}
      />
    );
  };

  it("names the trigger of a short single-select", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    expect(ui.getByRole("combobox", { name: "Pick a tag" })).toBeTruthy();
  });

  it("names it past the option count that switches rendering path", async () => {
    // The component picks its shape on option count, and a name that appears
    // or vanishes at an arbitrary list length is the bug this whole file is
    // about, one threshold along.
    const alepha = await start();
    const ui = mount(alepha, <Probe count={25} />);

    expect(ui.getByRole("combobox", { name: "Pick a tag" })).toBeTruthy();
  });

  it("names the chips box of a multi-select", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe multi />);

    expect(ui.getByLabelText("Pick a tag")).toBeTruthy();
  });
});
