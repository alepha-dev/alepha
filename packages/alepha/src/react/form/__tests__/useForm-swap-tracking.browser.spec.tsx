import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useState } from "react";
import { describe, it } from "vitest";

import { useForm, useFormState, useFormValues } from "../index.ts";

/**
 * `useForm`'s `deps` parameter (see `useForm.ts`) lets a caller mint a
 * brand new `FormModel` — new `id`, fresh values store — whenever a
 * dependency changes. `useFormValues` and `useFormState` used to subscribe
 * to `alepha.events.on("form:change", ...)` inside a `useEffect(() => {},
 * [])` with an EMPTY dependency array, closing over whichever `form` was
 * passed on the render where that effect first ran. A caller that swapped
 * forms via `deps` left both hooks listening for the OLD form's `id`
 * forever: the values/dirty/loading they returned froze at whatever the
 * old form last held, and never moved again for the new one.
 *
 * Found while building Lore's folio workspace (apps/lore) — the shell
 * that replaces one folio's editor buffer with another's when the user
 * switches documents. Lore works around the underlying issue locally by
 * forcing a full remount instead of relying on `deps` (see
 * `FolioWorkspace.tsx`'s doc comment), but `deps` is a documented public
 * parameter of `useForm` and must behave correctly for callers who reach
 * for it directly, not just for Lore's workaround.
 */
describe("useFormValues / useFormState track a form that changes identity", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const docs: Record<string, { title: string }> = {
    a: { title: "Document A" },
    b: { title: "Document B" },
  };

  const Widget = () => {
    const [docId, setDocId] = useState<"a" | "b">("a");
    // `deps: [docId]` mints a brand new FormModel whenever docId changes.
    const form = useForm(
      {
        id: `doc-${docId}`,
        schema: z.object({ title: z.string() }),
        initialValues: docs[docId],
        handler: async () => {},
      },
      [docId],
    );
    const values = useFormValues(form);
    const { dirty } = useFormState(form, ["dirty"]);

    return (
      <div>
        <input
          data-testid="title"
          value={(values.title as string) ?? ""}
          onChange={(e) => form.input.title.set(e.target.value)}
        />
        <span data-testid="dirty">{dirty ? "dirty" : "clean"}</span>
        <button
          type="button"
          data-testid="switch"
          onClick={() => setDocId("b")}
        >
          switch
        </button>
      </div>
    );
  };

  it("re-seeds useFormValues from the new form's initial values on a form swap", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const { getByTestId } = mount(alepha, <Widget />);

    expect((getByTestId("title") as HTMLInputElement).value).toBe("Document A");

    fireEvent.change(getByTestId("title"), {
      target: { value: "Document A, edited" },
    });
    await waitFor(() =>
      expect((getByTestId("title") as HTMLInputElement).value).toBe(
        "Document A, edited",
      ),
    );

    fireEvent.click(getByTestId("switch"));

    // Must show document B's title immediately — never a frozen
    // "Document A, edited" carried over from the FormModel that just got
    // replaced.
    await waitFor(() =>
      expect((getByTestId("title") as HTMLInputElement).value).toBe(
        "Document B",
      ),
    );
  });

  it("re-seeds useFormState's dirty flag to false on a form swap", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const { getByTestId } = mount(alepha, <Widget />);

    expect(getByTestId("dirty").textContent).toBe("clean");

    fireEvent.change(getByTestId("title"), {
      target: { value: "Document A, edited" },
    });
    await waitFor(() => expect(getByTestId("dirty").textContent).toBe("dirty"));

    fireEvent.click(getByTestId("switch"));

    // The new form (document B) has not been touched — dirty must not
    // carry over from document A.
    await waitFor(() => expect(getByTestId("dirty").textContent).toBe("clean"));
  });

  it("keeps responding to field changes on the new form after a swap", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const { getByTestId } = mount(alepha, <Widget />);

    fireEvent.click(getByTestId("switch"));
    await waitFor(() =>
      expect((getByTestId("title") as HTMLInputElement).value).toBe(
        "Document B",
      ),
    );

    // If the hooks were still listening for the OLD form's id, this edit
    // on the NEW form would never be observed.
    fireEvent.change(getByTestId("title"), {
      target: { value: "Document B, edited" },
    });
    await waitFor(() =>
      expect((getByTestId("title") as HTMLInputElement).value).toBe(
        "Document B, edited",
      ),
    );
    expect(getByTestId("dirty").textContent).toBe("dirty");
  });
});
