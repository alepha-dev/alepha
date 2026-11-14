import { fireEvent, render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { Control } from "../Control.tsx";
import { emailDomainCompletion } from "../emailDomainCompletion.ts";

describe("emailDomainCompletion", () => {
  it("completes the domain from what follows the @", ({ expect }) => {
    expect(emailDomainCompletion("jane@g")).toBe("mail.com");
    expect(emailDomainCompletion("jane@HOT")).toBe("mail.com");
    expect(emailDomainCompletion("jane@gmail.co")).toBe("m");
  });

  it("suggests nothing without a typed domain prefix", ({ expect }) => {
    expect(emailDomainCompletion("jane")).toBe("");
    expect(emailDomainCompletion("jane@")).toBe("");
    expect(emailDomainCompletion("@g")).toBe("");
    expect(emailDomainCompletion("jane@gmail.com")).toBe("");
    expect(emailDomainCompletion("jane@acme.io")).toBe("");
    expect(emailDomainCompletion("a@b@g")).toBe("");
  });

  it("takes the caller's domains", ({ expect }) => {
    expect(emailDomainCompletion("jane@a", ["acme.io"])).toBe("cme.io");
  });
});

describe("Control email domain suggestion", () => {
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
    autoComplete?: string;
    emailDomains?: false;
    plain?: boolean;
  }) => {
    const form = useForm({
      schema: z.object({
        value: props.plain ? z.text() : z.text({ format: "email" }),
      }),
      handler: () => {},
    });
    return (
      <Control
        input={form.input.value}
        autoComplete={props.autoComplete}
        emailDomains={props.emailDomains}
      />
    );
  };

  const input = (container: HTMLElement) =>
    container.querySelector("input") as HTMLInputElement;
  const ghost = (container: HTMLElement) =>
    container.querySelector('[data-slot="control-email-suggestion"]');

  const typeIn = (container: HTMLElement, value: string) => {
    fireEvent.focus(input(container));
    fireEvent.change(input(container), { target: { value } });
  };

  it("shows the rest of the domain and Tab accepts it", async ({ expect }) => {
    const { container } = mount(await start(), <Probe />);

    typeIn(container, "jane@g");
    expect(ghost(container)?.textContent).toBe("jane@gmail.com");

    fireEvent.keyDown(input(container), { key: "Tab" });
    expect(input(container).value).toBe("jane@gmail.com");
    expect(ghost(container)).toBeNull();
  });

  it("hides on blur and on Escape", async ({ expect }) => {
    const { container } = mount(await start(), <Probe />);

    typeIn(container, "jane@g");
    fireEvent.blur(input(container));
    expect(ghost(container)).toBeNull();

    fireEvent.focus(input(container));
    fireEvent.keyDown(input(container), { key: "Escape" });
    expect(ghost(container)).toBeNull();
    fireEvent.keyDown(input(container), { key: "Tab" });
    expect(input(container).value).toBe("jane@g");
  });

  it("applies to a sign-in identifier hinted as username", async ({
    expect,
  }) => {
    const { container } = mount(
      await start(),
      <Probe plain autoComplete="username webauthn" />,
    );

    typeIn(container, "jane@o");
    expect(ghost(container)?.textContent).toBe("jane@outlook.com");
  });

  it("stays off for plain text and when turned off", async ({ expect }) => {
    const plain = mount(await start(), <Probe plain />);
    typeIn(plain.container, "jane@g");
    expect(ghost(plain.container)).toBeNull();

    const off = mount(await start(), <Probe emailDomains={false} />);
    typeIn(off.container, "jane@g");
    expect(ghost(off.container)).toBeNull();
  });
});
