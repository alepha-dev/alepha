import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useEffect, useState } from "react";
import { describe, type ExpectStatic, it } from "vitest";

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

/**
 * A submit's success says the values it SENT are saved. An edit made while it
 * was in flight is not among them, so the form is still dirty when it lands:
 * marked clean, a Save button gated on `dirty` could never send that edit.
 */
describe("useFormState dirty across a submit", () => {
  it("stays dirty when a field was edited while the submit was in flight", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const sent: unknown[] = [];
    let release: () => void = () => {};
    let setName: (value: string) => void = () => {};
    const Widget = () => {
      const form = useForm({
        schema: z.object({ name: z.text() }),
        initialValues: { name: "a" },
        handler: (values) => {
          sent.push(values);
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      });
      setName = form.input.name.set;
      const { dirty, loading } = useFormState(form, ["dirty", "loading"]);
      return (
        <form {...form.props} data-testid="form">
          <span data-testid="dirty">{dirty ? "dirty" : "clean"}</span>
          <span data-testid="loading">{loading ? "loading" : "idle"}</span>
        </form>
      );
    };
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <Widget />
      </AlephaContext.Provider>,
    );
    const text = (id: string) => ui.getByTestId(id).textContent;

    act(() => setName("b"));
    fireEvent.submit(ui.getByTestId("form"));
    await waitFor(() => expect(sent).toEqual([{ name: "b" }]));

    act(() => setName("c"));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(text("loading")).toBe("idle"));
    expect(text("dirty")).toBe("dirty");
  });

  it("turns clean when nothing was edited during the submit", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let setName: (value: string) => void = () => {};
    const Widget = () => {
      const form = useForm({
        schema: z.object({ name: z.text() }),
        initialValues: { name: "a" },
        handler: async () => {},
      });
      setName = form.input.name.set;
      const { dirty } = useFormState(form, ["dirty"]);
      return (
        <form {...form.props} data-testid="form">
          <span data-testid="dirty">{dirty ? "dirty" : "clean"}</span>
        </form>
      );
    };
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <Widget />
      </AlephaContext.Provider>,
    );

    act(() => setName("b"));
    await waitFor(() =>
      expect(ui.getByTestId("dirty").textContent).toBe("dirty"),
    );
    fireEvent.submit(ui.getByTestId("form"));
    await waitFor(() =>
      expect(ui.getByTestId("dirty").textContent).toBe("clean"),
    );
  });

  /**
   * A write made by the handler itself is not an edit waiting to be sent.
   * `write` is what the handler does with the model once it has "saved".
   */
  const mountWriting = (
    alepha: Alepha,
    write: (set: (value: string) => void, sent: string) => void,
    expect: ExpectStatic,
  ) => {
    const sent: string[] = [];
    const holder: { setName: (value: string) => void } = { setName: () => {} };
    const Widget = () => {
      const form = useForm({
        schema: z.object({ name: z.text() }),
        initialValues: { name: "a" },
        handler: async (values) => {
          sent.push(values.name);
          write(form.input.name.set, values.name);
        },
      });
      useEffect(() => {
        holder.setName = form.input.name.set;
      }, [form]);
      const { dirty, loading } = useFormState(form, ["dirty", "loading"]);
      const values = useFormValues(form);
      return (
        <form {...form.props} data-testid="form">
          <span data-testid="dirty">{dirty ? "dirty" : "clean"}</span>
          <span data-testid="loading">{loading ? "loading" : "idle"}</span>
          <span data-testid="name">{String(values.name)}</span>
        </form>
      );
    };
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <Widget />
      </AlephaContext.Provider>,
    );
    const text = (id: string) => ui.getByTestId(id).textContent;
    const submit = async (expected: number) => {
      fireEvent.submit(ui.getByTestId("form"));
      await waitFor(() => expect(sent).toHaveLength(expected));
      await waitFor(() => expect(text("loading")).toBe("idle"));
    };
    return { holder, sent, text, submit };
  };

  it("turns clean when the handler writes back the value it sent", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const { holder, text, submit } = mountWriting(
      alepha,
      (set, sent) => set(sent.trim()),
      expect,
    );

    act(() => holder.setName("  b  "));
    await waitFor(() => expect(text("dirty")).toBe("dirty"));
    await submit(1);
    expect(text("name")).toBe("b");
    expect(text("dirty")).toBe("clean");

    // And stays clean over a second submit nobody typed before.
    await submit(2);
    expect(text("dirty")).toBe("clean");
  });

  it("turns clean when the handler puts the baseline back", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const { holder, text, submit } = mountWriting(
      alepha,
      (set) => set("a"),
      expect,
    );

    act(() => holder.setName("b"));
    await waitFor(() => expect(text("dirty")).toBe("dirty"));
    await submit(1);
    expect(text("name")).toBe("a");
    expect(text("dirty")).toBe("clean");
  });
});
