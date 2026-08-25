import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useState } from "react";
import { describe, it } from "vitest";

import { useForm, useFormValues } from "../index.ts";

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
