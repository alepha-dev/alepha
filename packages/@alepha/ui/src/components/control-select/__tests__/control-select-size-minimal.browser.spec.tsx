import { cleanup, render } from "@testing-library/react";
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
    /**
     * `clearable` plus a chosen value, which is what `showClear` needs: the
     * button does not exist on an empty control.
     */
    clearable?: boolean;
  }) => {
    const form = useForm({
      schema: z.object({ tag: z.text().optional() as never }),
      initialValues: props.clearable ? ({ tag: "one" } as never) : undefined,
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
        clearable={props.clearable}
      />
    );
  };

  const triggerOf = (ui: ReturnType<typeof render>) =>
    ui.getByRole("combobox", { name: "Pick a tag" });

  const clearOf = (ui: ReturnType<typeof render>) =>
    ui.getByRole("button", { name: "Clear selection" });

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

  /**
   * Feedback #2113: the clear `x` was positioned with `right-8`, which is the
   * DEFAULT size's right padding plus its chevron. At `sm` and `xs` both
   * shrink, so the chevron moved left while the `x` stayed 32px from the edge
   * and landed on the value.
   *
   * These are class assertions rather than measurements on purpose: jsdom
   * computes no geometry, so what can be pinned here is that the offset comes
   * from the size TABLE and not from a constant. Whether 20px is the right
   * number at `xs` is a question for a browser, and the quest answered it
   * there.
   *
   * ⚠️ And that is the limit of this file, demonstrated the hard way. The
   * offsets below were `right-*` until #Q2283, positioning the `x` against the
   * WRAPPER - which is the `FormField`'s full width, not the trigger's - so a
   * narrowed trigger left its `x` hundreds of pixels outside itself while
   * every case here stayed green. A class is not a position. The assertion
   * that the `x` lands ON the trigger lives in `apps/ui/e2e/blocks.spec.ts`,
   * where a browser lays the page out.
   */
  describe("the clear button's placement", () => {
    it("takes its offset from the size, not from a constant", async () => {
      const alepha = await start();
      // One mount at a time: `mount` renders into the shared container, so
      // two live probes put two "Clear selection" buttons in the document
      // and the query matches both.
      const offsetAt = (ui: ReturnType<typeof render>) => {
        const found = clearOf(ui).className;
        cleanup();
        return found;
      };

      // A negative left MARGIN, because the button is in flow as the
      // trigger's next flex sibling and walks back over it from the trigger's
      // own right edge. The numbers are the ones feedback #2113 tuned; what
      // changed with #Q2283 is what they are measured from.
      expect(offsetAt(mount(alepha, <Probe clearable />))).toContain("-ml-8");
      expect(offsetAt(mount(alepha, <Probe size="sm" clearable />))).toContain(
        "-ml-7",
      );
      expect(offsetAt(mount(alepha, <Probe size="xs" clearable />))).toContain(
        "-ml-5",
      );
    });

    it("needs no correction under minimal, and carries none", async () => {
      const alepha = await start();
      // `MINIMAL_CLASSES` carries `-mx-1`, and in flow that margin moves where
      // the next sibling starts - so the `x` follows the trigger's edge on its
      // own. The `translate-x-1` that used to be added here was correcting for
      // the absolute positioning AND pointing the wrong way: it read `-mx-1`
      // as pushing the trigger's right edge 4px past the wrapper, when an
      // over-constrained block drops that margin and the edge falls 4px short.
      // The `x` ended up overlapping the chevron by 5px, measured.
      const shifted = clearOf(
        mount(alepha, <Probe size="xs" minimal clearable />),
      ).className;
      cleanup();

      expect(shifted).not.toContain("translate-x-1");
      // The one translate it does carry is its own width, at every size and
      // variant: a flex item's margin places its LEFT edge, and the offset
      // above describes its right one.
      expect(shifted).toContain("-translate-x-full");
      expect(
        clearOf(mount(alepha, <Probe size="xs" clearable />)).className,
      ).toContain("-translate-x-full");
    });

    it("reads lighter than the chevron at rest, and sharpens when reached for", async () => {
      const alepha = await start();
      const clear = clearOf(mount(alepha, <Probe clearable />));

      // Not peers: the chevron is decoration, this is the only element with
      // its own action. Alpha on the TEXT colour rather than `opacity`, which
      // would fade the focus ring with it.
      expect(clear.className).toContain("text-muted-foreground/60");
      expect(clear.className).toContain("hover:text-foreground");
      expect(clear.className).toContain("focus-visible:text-foreground");
      // Visible at rest: no hover reveal. There is no hover on touch, and it
      // is the only discoverable way to clear.
      expect(clear.className).not.toContain("opacity-0");
    });
  });
});
