// oxlint-disable jsx-a11y/no-autofocus -- the prop under test is the point
import { render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { Control } from "../control.tsx";

/**
 * `autoFocus` is documented on `Control` and was being dropped: a lint pass
 * removed the forwarding and left the prop declared, so login and dialog forms
 * silently stopped focusing their first field. Two components had already
 * worked around it with `getElementById(...).focus()`.
 */
describe("Control autoFocus", () => {
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
    variant: "text" | "password" | "number" | "area";
  }) => {
    const form = useForm({
      schema: z.object({
        text: z.text(),
        password: z.text(),
        count: z.number(),
        bio: z.text(),
      }),
      handler: () => {},
    });

    if (props.variant === "password") {
      return <Control input={form.input.password} password autoFocus />;
    }
    if (props.variant === "number") {
      return <Control input={form.input.count} autoFocus />;
    }
    if (props.variant === "area") {
      return <Control input={form.input.bio} area autoFocus />;
    }
    return <Control input={form.input.text} autoFocus />;
  };

  const focusedTag = () => document.activeElement?.tagName.toLowerCase();

  it("should focus a text control", async () => {
    const { container } = mount(await start(), <Probe variant="text" />);

    await waitFor(() => {
      expect(document.activeElement).toBe(container.querySelector("input"));
    });
  });

  it("should focus a password control", async () => {
    const { container } = mount(await start(), <Probe variant="password" />);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector('input[type="password"]'),
      );
    });
  });

  it("should focus a number control", async () => {
    const { container } = mount(await start(), <Probe variant="number" />);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector('input[type="number"]'),
      );
    });
  });

  it("should focus a textarea control", async () => {
    mount(await start(), <Probe variant="area" />);

    await waitFor(() => {
      expect(focusedTag()).toBe("textarea");
    });
  });

  it("should leave focus alone without the prop", async () => {
    const NoFocus = () => {
      const form = useForm({
        schema: z.object({ text: z.text() }),
        handler: () => {},
      });
      return <Control input={form.input.text} />;
    };

    mount(await start(), <NoFocus />);

    expect(focusedTag()).toBe("body");
  });
});
