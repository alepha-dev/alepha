import { render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AutoForm, type AutoFormProps } from "../auto-form.tsx";

/**
 * `fill` + `autoGroup` is the `/admin/parameters` shape, and it had no
 * coverage at all. The bug it hid: `CardContent` under `fill` is a flex column
 * with a definite height, `autoGroupSchema` emits one titled "General" group
 * plus one naked group per object field, and only the titled one carried
 * `overflow-hidden`. Per the flexbox automatic-minimum-size rule that made it
 * the single child with an auto min size of 0, so expanding the object groups
 * pushed the whole overflow into it and it collapsed to zero height.
 *
 * jsdom does no layout, so these pin the class contract that decides the
 * layout rather than the measured height: every group root is `shrink-0`, and
 * the scrolling stays on `CardContent`, where it was asked for.
 */
describe("AutoForm fill + autoGroup", () => {
  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  /**
   * One scalar (so "General" exists) and two object fields (so `autoGroup`
   * emits two naked sibling groups): the parameters schema in miniature.
   */
  const Probe = (props: Partial<AutoFormProps<any>>) => {
    const form = useForm({
      initialValues: {
        issuer: "",
        passwordPolicy: { minLength: 8 },
        loginRateLimit: { max: 5 },
      },
      schema: z.object({
        issuer: z.string(),
        passwordPolicy: z.object({ minLength: z.number() }),
        loginRateLimit: z.object({ max: z.number() }),
      }),
      handler: () => {},
    });
    return <AutoForm form={form} fill autoGroup card {...props} />;
  };

  const groupRoots = (container: HTMLElement) =>
    Array.from(
      container.querySelector('[data-slot="card-content"]')?.children ?? [],
    );

  it("emits one titled group and one naked group per object field", async () => {
    const alepha = await start();
    const { container } = mount(alepha, <Probe />);

    const roots = groupRoots(container);
    expect(roots).toHaveLength(3);
    // Only the titled one gets card chrome; the naked ones render bare so the
    // object control's own header is not doubled.
    expect(roots.filter((r) => r.className.includes("border"))).toHaveLength(1);
  });

  it("keeps every group at its content height", async () => {
    const alepha = await start();
    const { container } = mount(alepha, <Probe />);

    // Every root, not just the titled one: whichever group is allowed to
    // shrink becomes the one that vanishes, so none of them may.
    for (const root of groupRoots(container)) {
      expect(root.className).toContain("shrink-0");
    }
  });

  it("leaves the scrolling on CardContent", async () => {
    const alepha = await start();
    const { container } = mount(alepha, <Probe />);

    // The counterpart of `shrink-0`: the groups now overflow the card, and
    // this is what has to absorb it.
    const content = container.querySelector('[data-slot="card-content"]');
    expect(content?.className).toContain("overflow-y-auto");
    expect(content?.className).toContain("min-h-0");
  });

  it("marks the row layout's group root too", async () => {
    const alepha = await start();
    const { container } = mount(alepha, <Probe layout="row" />);

    for (const root of groupRoots(container)) {
      expect(root.className).toContain("shrink-0");
    }
  });
});
