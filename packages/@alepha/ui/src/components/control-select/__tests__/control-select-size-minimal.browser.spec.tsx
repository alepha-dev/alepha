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
 * `size` and `minimal` on a select-shaped `Control`.
 *
 * They exist for a control that sits ON a row of text rather than in a form:
 * Lore's quest rail, where `Assigned` is a small transparent trigger reading
 * as part of the line and `Release` was a boxed, default-height select
 * visibly heavier than every row around it (#1703).
 *
 * Asserted through `Control` rather than `ControlSelect`, for the reason its
 * neighbour `control-select-trigger-props.browser.spec.tsx` gives: the props
 * that go missing go missing in the hand-off between the two, and a test on
 * the inner component passes throughout.
 */
describe("Control size and minimal on a select", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const Probe = (props: {
    size?: "xs" | "sm" | "default";
    minimal?: boolean;
  }) => {
    const form = useForm({
      schema: z.object({ tag: z.text().optional() as never }),
      handler: () => {},
    });
    return (
      <Control
        input={form.input.tag}
        label=""
        inputProps={{ "aria-label": "Pick a tag" }}
        items={["one", "two", "three"]}
        size={props.size}
        minimal={props.minimal}
      />
    );
  };

  const triggerOf = (ui: ReturnType<typeof render>) =>
    ui.getByRole("combobox", { name: "Pick a tag" });

  it("is default height with neither prop", async () => {
    const alepha = await start();
    const trigger = triggerOf(mount(alepha, <Probe />));

    expect(trigger.className).toContain("h-8");
    expect(trigger.className).toContain("text-sm");
    // The bordered box is what `minimal` removes, so it has to be here.
    expect(trigger.className).toContain("border-input");
    expect(trigger.className).not.toContain("border-transparent");
  });

  it("shrinks to the rail's type scale at xs", async () => {
    const alepha = await start();
    const trigger = triggerOf(mount(alepha, <Probe size="xs" />));

    expect(trigger.className).toContain("h-6");
    expect(trigger.className).toContain("text-xs");
    expect(trigger.className).not.toContain("h-8");
  });

  it("takes an intermediate sm", async () => {
    const alepha = await start();
    const trigger = triggerOf(mount(alepha, <Probe size="sm" />));

    expect(trigger.className).toContain("h-7");
  });

  it("drops the box when minimal, keeping a hover tint", async () => {
    const alepha = await start();
    const trigger = triggerOf(mount(alepha, <Probe minimal />));

    expect(trigger.className).toContain("border-transparent");
    expect(trigger.className).toContain("bg-transparent");
    expect(trigger.className).toContain("shadow-none");
    // Without it the control is indistinguishable from static text.
    expect(trigger.className).toContain("hover:bg-muted");
    // Pulled left by its own padding, so its text aligns with plain rows.
    expect(trigger.className).toContain("-mx-1");
  });

  it("combines: the shape the quest rail asks for", async () => {
    const alepha = await start();
    const trigger = triggerOf(mount(alepha, <Probe size="xs" minimal />));

    expect(trigger.className).toContain("h-6");
    expect(trigger.className).toContain("text-xs");
    expect(trigger.className).toContain("border-transparent");
  });

  it("sizes the chevron from the trigger, not from the stock primitive", async () => {
    // `ComboboxTrigger` appends its chevron at a hardcoded `size-4` and lives
    // in `ui/`, which `yarn sync` overwrites wholesale - so the size has to
    // come from here, via a descendant selector, or it comes back on the next
    // refresh.
    const alepha = await start();
    const trigger = triggerOf(mount(alepha, <Probe size="xs" />));

    expect(trigger.className).toContain("[&>svg]:size-3");
  });
});
