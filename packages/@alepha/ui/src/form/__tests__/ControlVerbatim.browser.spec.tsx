import { render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * Found on an iOS simulator: the keyboard capitalised the first letter of the
 * sign-in identifier ("Test@mobile.test"), so the sign-in failed. A field that
 * holds a value typed verbatim turns capitalisation, correction and spelling
 * off.
 */
describe("Control verbatim fields", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const Probe = (props: { autoComplete?: string; format?: "email" }) => {
    const form = useForm({
      schema: z.object({
        value:
          props.format === "email" ? z.text({ format: "email" }) : z.text(),
      }),
      handler: () => {},
    });
    return (
      <Control input={form.input.value} autoComplete={props.autoComplete} />
    );
  };

  const input = (container: HTMLElement) =>
    container.querySelector("input") as HTMLInputElement;

  it("does not let the keyboard rewrite a username", async ({ expect }) => {
    const { container } = mount(
      await start(),
      <Probe autoComplete="username" />,
    );

    expect(input(container).getAttribute("autocapitalize")).toBe("none");
    expect(input(container).getAttribute("autocorrect")).toBe("off");
    expect(input(container).getAttribute("spellcheck")).toBe("false");
  });

  it("does the same for an email field derived from the schema", async ({
    expect,
  }) => {
    const { container } = mount(await start(), <Probe format="email" />);

    expect(input(container).getAttribute("autocapitalize")).toBe("none");
  });

  it("leaves ordinary text alone", async ({ expect }) => {
    const { container } = mount(await start(), <Probe />);

    expect(input(container).hasAttribute("autocapitalize")).toBe(false);
    expect(input(container).hasAttribute("spellcheck")).toBe(false);
  });
});
