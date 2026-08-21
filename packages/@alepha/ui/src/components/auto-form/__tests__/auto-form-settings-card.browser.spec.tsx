import { render, screen } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AutoForm, type AutoFormProps } from "../auto-form.tsx";

/**
 * `layout="row"` is not a near-miss of the settings-card shape, it is that
 * shape — so these pin the three things that make it one and are invisible in
 * a screenshot review: the action bar belongs to the card rather than to a
 * second bordered box under it, the heading comes from `SettingsHeading`, and
 * a text control takes the settings column width.
 *
 * The regression these guard against is the reverse direction too: the grid
 * layout and `autoSave` must keep the chrome they had, since every existing
 * caller is one of those.
 */
describe("AutoForm settings-card layout", () => {
  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const Probe = (props: Partial<AutoFormProps<any>>) => {
    const form = useForm({
      initialValues: { username: "" },
      schema: z.object({ username: z.string() }),
      handler: () => {},
    });
    return (
      <AutoForm
        form={form}
        fields={{ username: { label: "Username" } }}
        {...props}
      />
    );
  };

  it("renders the action bar as the card's own last row", async () => {
    const alepha = await start();
    const { container } = mount(
      alepha,
      <Probe layout="row" groups={[{ fields: ["username"] }]} />,
    );

    const card = container.querySelector(".divide-y");
    expect(card).toBeTruthy();
    // Inside the card, so `divide-y` draws the rule above it. A standalone bar
    // would sit outside and read as a second card.
    expect(card?.contains(screen.getByRole("button", { name: "Save" }))).toBe(
      true,
    );
    expect(card?.contains(screen.getByRole("button", { name: "Reset" }))).toBe(
      true,
    );
  });

  it("gives the action row the same padding as a field row", async () => {
    const alepha = await start();
    const { container } = mount(
      alepha,
      <Probe layout="row" groups={[{ fields: ["username"] }]} />,
    );

    const card = container.querySelector(".divide-y");
    const rows = Array.from(card?.children ?? []);
    // Field row, then action row — and both on the card's `px-4 py-3` rhythm,
    // or the rule above the buttons lands at a different inset than the ones
    // between fields.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).toContain("px-4");
      expect(row.className).toContain("py-3");
    }
  });

  it("matches the card chrome SettingsSection renders", async () => {
    const alepha = await start();
    const { container } = mount(
      alepha,
      <Probe layout="row" groups={[{ fields: ["username"] }]} />,
    );

    const card = container.querySelector(".divide-y");
    for (const cls of ["rounded-lg", "border", "bg-card", "shadow-sm"]) {
      expect(card?.className).toContain(cls);
    }
  });

  it("renders a group description above the card", async () => {
    const alepha = await start();
    mount(
      alepha,
      <Probe
        layout="row"
        groups={[
          {
            title: "Name",
            description: "How you are identified to other people.",
            fields: ["username"],
          },
        ]}
      />,
    );

    expect(screen.getByText("Name")).toBeTruthy();
    expect(
      screen.getByText("How you are identified to other people."),
    ).toBeTruthy();
  });

  it("gives a text control the settings column width", async () => {
    const alepha = await start();
    mount(alepha, <Probe layout="row" groups={[{ fields: ["username"] }]} />);

    // The right-hand cell is an `auto` grid column, so `w-full` alone leaves
    // the input at its ~172px intrinsic size and every card gets a different
    // control column.
    expect(
      screen.getByRole("textbox", { name: "Username" }).className,
    ).toContain("sm:w-64");
  });

  it("lets a caller override the settings column width", async () => {
    const alepha = await start();
    mount(
      alepha,
      <Probe
        layout="row"
        groups={[{ fields: ["username"] }]}
        fields={{
          username: {
            label: "Username",
            inputProps: { className: "sm:w-96" },
          },
        }}
      />,
    );

    // tailwind-merge, not both classes landing on the element: at `sm` the
    // caller's width has to be the only one that applies.
    // `getByRole`, not `getByLabelText`: `username` is required here, and the
    // marker `FormField` renders for that puts a literal "*" in the label's
    // text content even though it is `aria-hidden`.
    const className = screen.getByRole("textbox", {
      name: "Username",
    }).className;
    expect(className).toContain("sm:w-96");
    expect(className).not.toContain("sm:w-64");
  });

  it("marks a required field with an asterisk by default", async () => {
    const alepha = await start();
    mount(alepha, <Probe layout="row" groups={[{ fields: ["username"] }]} />);

    expect(screen.getByText("*")).toBeTruthy();
  });

  it("hides the asterisk under requiredMarker={false}", async () => {
    const alepha = await start();
    mount(
      alepha,
      <Probe
        layout="row"
        requiredMarker={false}
        groups={[{ fields: ["username"] }]}
      />,
    );

    expect(screen.queryByText("*")).toBeNull();
  });

  it("still announces the field as required with the marker hidden", async () => {
    const alepha = await start();
    mount(
      alepha,
      <Probe
        layout="row"
        requiredMarker={false}
        groups={[{ fields: ["username"] }]}
      />,
    );

    // The asterisk is `aria-hidden`, so it never carried this to a screen
    // reader — `aria-required` does, and it comes from the schema. If hiding
    // the marker ever took this with it, the prop would have quietly turned a
    // cosmetic choice into an accessibility regression.
    expect(
      screen
        .getByRole("textbox", { name: "Username" })
        .getAttribute("aria-required"),
    ).toBe("true");
  });

  it("still hides the action bar under autoSave", async () => {
    const alepha = await start();
    mount(
      alepha,
      <Probe layout="row" autoSave groups={[{ fields: ["username"] }]} />,
    );

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("leaves the grid layout's standalone bar alone", async () => {
    const alepha = await start();
    const { container } = mount(
      alepha,
      <Probe groups={[{ fields: ["username"] }]} />,
    );

    // No settings card at all in the grid layout, so the bar has nowhere to
    // move into and must still render as its own bordered box.
    expect(container.querySelector(".divide-y")).toBeNull();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.closest(".rounded-md")?.className).toContain("border");
  });

  it("keeps the submit button when the schema resolves to no fields", async () => {
    const alepha = await start();
    // A group whose fields do not exist on the form used to render nothing at
    // all, which in row layout would have taken the action bar down with it.
    mount(alepha, <Probe layout="row" groups={[{ fields: ["nope"] }]} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
