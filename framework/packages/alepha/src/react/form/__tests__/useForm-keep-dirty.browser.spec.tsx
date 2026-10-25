import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useState } from "react";
import { describe, it } from "vitest";

import { useForm, useFormState, useFormValues } from "../index.ts";

/**
 * A page that refetches after a save hands `useForm` new `initialValues`,
 * and re-seeding from them wholesale overwrote whatever the user had typed
 * between pressing submit and the response landing - with data that predates
 * their own edit.
 *
 * The rule is per FIELD, not per form: the server's answer wins everywhere
 * the user has not touched since the last seed.
 */
describe("useForm keeps dirty fields when initialValues change", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const schema = z.object({ first: z.string(), last: z.string() });

  const Widget = (props: { keepDirty?: boolean }) => {
    // Stands in for the refetched server response.
    const [server, setServer] = useState({ first: "Ada", last: "Lovelace" });

    const form = useForm({
      schema,
      initialValues: server,
      keepDirty: props.keepDirty,
      handler: async () => {},
    });
    const values = useFormValues(form);

    return (
      <div>
        <input
          data-testid="first"
          value={(values.first as string) ?? ""}
          onChange={(e) => form.input.first.set(e.target.value)}
        />
        <input
          data-testid="last"
          value={(values.last as string) ?? ""}
          onChange={(e) => form.input.last.set(e.target.value)}
        />
        <button
          type="button"
          data-testid="refetch"
          onClick={() => setServer({ first: "Ada", last: "King" })}
        >
          refetch
        </button>
      </div>
    );
  };

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    return alepha;
  };

  it("keeps a field edited before the response landed", async ({ expect }) => {
    const alepha = await start();
    const { getByTestId } = mount(alepha, <Widget />);

    fireEvent.change(getByTestId("first"), { target: { value: "Grace" } });
    await waitFor(() =>
      expect((getByTestId("first") as HTMLInputElement).value).toBe("Grace"),
    );

    fireEvent.click(getByTestId("refetch"));

    await waitFor(() =>
      // Untouched, so the server's answer wins.
      expect((getByTestId("last") as HTMLInputElement).value).toBe("King"),
    );
    // Typed meanwhile, so it survives.
    expect((getByTestId("first") as HTMLInputElement).value).toBe("Grace");
  });

  it("re-seeds everything when keepDirty is off", async ({ expect }) => {
    const alepha = await start();
    const { getByTestId } = mount(alepha, <Widget keepDirty={false} />);

    fireEvent.change(getByTestId("first"), { target: { value: "Grace" } });
    await waitFor(() =>
      expect((getByTestId("first") as HTMLInputElement).value).toBe("Grace"),
    );

    fireEvent.click(getByTestId("refetch"));

    await waitFor(() =>
      expect((getByTestId("last") as HTMLInputElement).value).toBe("King"),
    );
    expect((getByTestId("first") as HTMLInputElement).value).toBe("Ada");
  });
});

/**
 * The half `keepDirty` still got wrong: it decided "edited" by comparing the
 * current value against the baseline it is about to replace. An edit that
 * happens to restore that baseline is then indistinguishable from an
 * untouched field, so the server's answer overwrites it.
 *
 * It reads as an impossible sequence until you say it out loud: type a value,
 * save, change your mind and clear the field while the save is still in
 * flight. The clear puts the field back to what it held before the save, and
 * the response then puts the saved value back on screen. The user watches
 * their own deletion undone - which is the exact failure `keepDirty` exists
 * to prevent.
 *
 * The form has to stay DIRTY too. Keeping the value while reporting the form
 * pristine is barely better: a Save button gated on `dirty` never enables,
 * so the edit cannot be sent.
 */
describe("useForm keeps an edit that restores the previous value", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const schema = z.object({ last: z.string() });

  const Widget = () => {
    // Starts empty, and the save being simulated sets it to "Smith".
    const [server, setServer] = useState({ last: "" });

    const form = useForm({
      schema,
      initialValues: server,
      keepDirty: true,
      handler: async () => {},
    });
    const values = useFormValues(form);
    const { dirty } = useFormState(form, ["dirty"]);

    return (
      <div>
        <input
          data-testid="last"
          value={(values.last as string) ?? ""}
          onChange={(e) => form.input.last.set(e.target.value)}
        />
        <span data-testid="dirty">{dirty ? "dirty" : "pristine"}</span>
        <button
          type="button"
          data-testid="refetch"
          onClick={() => setServer({ last: "Smith" })}
        >
          refetch
        </button>
      </div>
    );
  };

  it("keeps a field cleared back to its old value while the save was in flight", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const { getByTestId } = mount(alepha, <Widget />);

    // Typed, saved (the button press is not modelled - only its effect on the
    // server, below), then cleared again before the response lands. The clear
    // puts the field back to the "" it was seeded with.
    fireEvent.change(getByTestId("last"), { target: { value: "Smith" } });
    await waitFor(() =>
      expect((getByTestId("last") as HTMLInputElement).value).toBe("Smith"),
    );
    fireEvent.change(getByTestId("last"), { target: { value: "" } });
    await waitFor(() =>
      expect((getByTestId("last") as HTMLInputElement).value).toBe(""),
    );

    // The save lands and answers with what it stored.
    fireEvent.click(getByTestId("refetch"));

    await waitFor(() =>
      expect((getByTestId("last") as HTMLInputElement).value).toBe(""),
    );
    // And the form knows it has something left to send.
    expect(getByTestId("dirty").textContent).toBe("dirty");
  });
});
