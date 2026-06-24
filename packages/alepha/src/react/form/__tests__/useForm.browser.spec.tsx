import { fireEvent, render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, it } from "vitest";
import { useFieldValue, useForm } from "../index.ts";

const TestInput = ({ input, testId }: { input: any; testId: string }) => {
  const [value, setValue] = useFieldValue(input);
  return (
    <input
      data-testid={testId}
      value={value ?? ""}
      onChange={(ev) => setValue(ev.target.value)}
    />
  );
};

describe("useForm", () => {
  const renderWithAlepha = (alepha: Alepha, element: ReactNode) => {
    return render(
      <AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
    );
  };

  it("should run handler on submit", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];
    const Form = () => {
      const form = useForm({
        id: "test",
        schema: z.object({
          str: z.text(),
          int: z.integer(),
          nested: z.object({
            str: z.text(),
            another: z.object({
              level: z.text(),
            }),
          }),
        }),
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="test-form">
          <TestInput input={form.input.str} testId="test-str" />
          <TestInput input={form.input.int} testId="test-int" />
          <TestInput
            input={form.input.nested.items.str}
            testId="test-nested.str"
          />
          <TestInput
            input={form.input.nested.items.another.items.level}
            testId="test-nested.another.level"
          />
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();

    const ui = renderWithAlepha(alepha, <Form />);

    fireEvent.change(ui.getByTestId("test-str"), {
      target: { value: "testuser" },
    });

    fireEvent.change(ui.getByTestId("test-int"), {
      target: { value: "123" },
    });

    fireEvent.change(ui.getByTestId("test-nested.str"), {
      target: { value: "nestedvalue" },
    });

    fireEvent.change(ui.getByTestId("test-nested.another.level"), {
      target: { value: "anothervalue" },
    });

    fireEvent.submit(ui.getByText("Submit"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({
      str: "testuser",
      int: 123,
      nested: {
        str: "nestedvalue",
        another: {
          level: "anothervalue",
        },
      },
    });
  });

  it("should provide correct InputField types for nested objects", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);

    const Form = () => {
      const form = useForm({
        id: "types-test",
        schema: z.object({
          name: z.text(),
          address: z.object({
            street: z.text(),
            city: z.text(),
            country: z.object({
              code: z.text(),
              name: z.text(),
            }),
          }),
        }),
        handler: () => {},
      });

      // Verify nested object InputFields have items property
      const addressInput = form.input.address;
      const streetInput = addressInput.items.street;
      const countryInput = addressInput.items.country;
      const countryCodeInput = countryInput.items.code;

      return (
        <div data-testid="type-check">
          <span data-testid="has-items">
            {addressInput.items ? "true" : "false"}
          </span>
          <span data-testid="street-path">{streetInput.path}</span>
          <span data-testid="country-code-path">{countryCodeInput.path}</span>
        </div>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Form />);

    expect(ui.getByTestId("has-items").textContent).toBe("true");
    expect(ui.getByTestId("street-path").textContent).toBe("/address/street");
    expect(ui.getByTestId("country-code-path").textContent).toBe(
      "/address/country/code",
    );
  });

  it("should provide ArrayInputField with items array for arrays", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);

    const Form = () => {
      const form = useForm({
        id: "array-test",
        schema: z.object({
          tags: z.array(z.text()),
          contacts: z.array(
            z.object({
              name: z.text(),
              email: z.text(),
            }),
          ),
        }),
        handler: () => {},
      });

      // Verify array InputFields have items property (initially empty)
      const tagsInput = form.input.tags;
      const contactsInput = form.input.contacts;

      return (
        <div data-testid="array-check">
          <span data-testid="tags-has-items">
            {Array.isArray(tagsInput.items) ? "true" : "false"}
          </span>
          <span data-testid="tags-items-length">{tagsInput.items.length}</span>
          <span data-testid="contacts-has-items">
            {Array.isArray(contactsInput.items) ? "true" : "false"}
          </span>
          <span data-testid="contacts-items-length">
            {contactsInput.items.length}
          </span>
          <span data-testid="tags-path">{tagsInput.path}</span>
          <span data-testid="contacts-path">{contactsInput.path}</span>
        </div>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Form />);

    // Arrays have items property as array (initially empty)
    expect(ui.getByTestId("tags-has-items").textContent).toBe("true");
    expect(ui.getByTestId("tags-items-length").textContent).toBe("0");
    expect(ui.getByTestId("contacts-has-items").textContent).toBe("true");
    expect(ui.getByTestId("contacts-items-length").textContent).toBe("0");
    expect(ui.getByTestId("tags-path").textContent).toBe("/tags");
    expect(ui.getByTestId("contacts-path").textContent).toBe("/contacts");
  });

  it("should update array values via set method", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    const Form = () => {
      const form = useForm({
        id: "array-set-test",
        schema: z.object({
          tags: z.array(z.text()),
        }),
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="array-form">
          <button
            type="button"
            data-testid="set-tags"
            onClick={() => form.input.tags.set(["tag1", "tag2", "tag3"])}
          >
            Set Tags
          </button>
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Form />);

    fireEvent.click(ui.getByTestId("set-tags"));
    fireEvent.submit(ui.getByText("Submit"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({
      tags: ["tag1", "tag2", "tag3"],
    });
  });

  it("should update array of objects via set method", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    const Form = () => {
      const form = useForm({
        id: "array-objects-test",
        schema: z.object({
          contacts: z.array(
            z.object({
              name: z.text(),
              email: z.text(),
            }),
          ),
        }),
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="array-objects-form">
          <button
            type="button"
            data-testid="set-contacts"
            onClick={() =>
              form.input.contacts.set([
                { name: "Alice", email: "alice@example.com" },
                { name: "Bob", email: "bob@example.com" },
              ])
            }
          >
            Set Contacts
          </button>
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Form />);

    fireEvent.click(ui.getByTestId("set-contacts"));
    fireEvent.submit(ui.getByText("Submit"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({
      contacts: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
  });

  it("should handle complex nested structures with objects and arrays", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    const Form = () => {
      const form = useForm({
        id: "complex-test",
        schema: z.object({
          company: z.object({
            name: z.text(),
            address: z.object({
              street: z.text(),
              city: z.text(),
            }),
          }),
          employees: z.array(
            z.object({
              name: z.text(),
              role: z.text(),
            }),
          ),
        }),
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="complex-form">
          <TestInput
            input={form.input.company.items.name}
            testId="complex-test-company.name"
          />
          <TestInput
            input={form.input.company.items.address.items.street}
            testId="complex-test-company.address.street"
          />
          <TestInput
            input={form.input.company.items.address.items.city}
            testId="complex-test-company.address.city"
          />
          <button
            type="button"
            data-testid="set-employees"
            onClick={() =>
              form.input.employees.set([
                { name: "Alice", role: "Engineer" },
                { name: "Bob", role: "Designer" },
              ])
            }
          >
            Set Employees
          </button>
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Form />);

    fireEvent.change(ui.getByTestId("complex-test-company.name"), {
      target: { value: "Acme Corp" },
    });
    fireEvent.change(ui.getByTestId("complex-test-company.address.street"), {
      target: { value: "123 Main St" },
    });
    fireEvent.change(ui.getByTestId("complex-test-company.address.city"), {
      target: { value: "New York" },
    });
    fireEvent.click(ui.getByTestId("set-employees"));
    fireEvent.submit(ui.getByText("Submit"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({
      company: {
        name: "Acme Corp",
        address: {
          street: "123 Main St",
          city: "New York",
        },
      },
      employees: [
        { name: "Alice", role: "Engineer" },
        { name: "Bob", role: "Designer" },
      ],
    });
  });

  it("should update initialValues after save so reset uses new values", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);

    const Form = () => {
      const [saved, setSaved] = useState({ name: "original" });

      const form = useForm({
        id: "reset-test",
        schema: z.object({
          name: z.text(),
        }),
        initialValues: saved,
        handler: async (values) => {
          setSaved({ ...values });
        },
      });

      return (
        <form {...form.props} data-testid="reset-form">
          <TestInput input={form.input.name} testId="reset-name" />
          <button type="submit">Save</button>
          <button type="reset">Reset</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Form />);

    const input = () =>
      (ui.getByTestId("reset-name") as HTMLInputElement).value;

    // Initial value
    expect(input()).toBe("original");

    // Edit and save
    fireEvent.change(ui.getByTestId("reset-name"), {
      target: { value: "updated" },
    });
    fireEvent.submit(ui.getByText("Save"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // After save, initialValues should be updated
    // Edit again
    fireEvent.change(ui.getByTestId("reset-name"), {
      target: { value: "temporary" },
    });
    expect(input()).toBe("temporary");

    // Reset should go back to saved value, not original
    fireEvent.click(ui.getByText("Reset"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(input()).toBe("updated");
  });
});

/**
 * Regression coverage for the "I filled the form but submit says it's empty"
 * bug. Symptom: callers build `initialValues` inline at the top of their
 * render (e.g. `{ priority: props.x?.priority ?? "optional", ... }`). Any
 * parent re-render produces a fresh object reference with the same content,
 * which previously triggered `setInitialValues` and silently wiped
 * user-typed values while leaving the DOM stale.
 *
 * Fix: deep-equality guard before reinitializing the form.
 */
describe("useForm — initialValues stability", () => {
  const renderWithAlepha = (alepha: Alepha, element: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
    );

  it("preserves user input when parent re-renders with reference-fresh but content-equal initialValues", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    /**
     * Parent owns a counter; bumping it forces a render of `Form` without
     * changing any input it cares about. `Form` builds its `initialValues`
     * inline every render — fresh reference, same content. This is the
     * exact shape of the QuestCreate bug.
     */
    const Parent = () => {
      const [, setTick] = useState(0);
      return (
        <>
          <button
            type="button"
            data-testid="rerender"
            onClick={() => setTick((n) => n + 1)}
          >
            Rerender
          </button>
          <Form />
        </>
      );
    };

    const Form = () => {
      const form = useForm({
        id: "stability-test",
        schema: z.object({
          title: z.text(),
          priority: z.text(),
        }),
        // Fresh object reference every render, identical content.
        initialValues: {
          priority: "optional",
        },
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="stability-form">
          <TestInput input={form.input.title} testId="stability-title" />
          <TestInput input={form.input.priority} testId="stability-priority" />
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);

    // User types into title — form state should now hold "First quest".
    fireEvent.change(ui.getByTestId("stability-title"), {
      target: { value: "First quest" },
    });

    // Parent re-renders. Pre-fix this wiped form state via setInitialValues.
    fireEvent.click(ui.getByTestId("rerender"));
    fireEvent.click(ui.getByTestId("rerender"));
    fireEvent.click(ui.getByTestId("rerender"));

    // The visible DOM AND the underlying form state must still have the
    // user's input. Submitting must yield the typed value, not an empty one.
    fireEvent.submit(ui.getByText("Submit"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({ title: "First quest", priority: "optional" });
  });

  it("survives many re-renders without drift (stress)", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    const Parent = () => {
      const [tick, setTick] = useState(0);
      return (
        <>
          <span data-testid="tick">{tick}</span>
          <button
            type="button"
            data-testid="rerender"
            onClick={() => setTick((n) => n + 1)}
          >
            Rerender
          </button>
          <Form />
        </>
      );
    };

    const Form = () => {
      const form = useForm({
        id: "stress-test",
        schema: z.object({ value: z.text() }),
        initialValues: { value: "" },
        handler: (values) => {
          calls.push(values);
        },
      });
      return (
        <form {...form.props}>
          <TestInput input={form.input.value} testId="stress-value" />
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);

    fireEvent.change(ui.getByTestId("stress-value"), {
      target: { value: "typed" },
    });
    for (let i = 0; i < 50; i++) {
      fireEvent.click(ui.getByTestId("rerender"));
    }
    fireEvent.submit(ui.getByText("Submit"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({ value: "typed" });
  });

  it("preserves user input when initialValues contains nested object rebuilt each render", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    const Parent = () => {
      const [, setTick] = useState(0);
      return (
        <>
          <button
            type="button"
            data-testid="rerender"
            onClick={() => setTick((n) => n + 1)}
          >
            Rerender
          </button>
          <Form />
        </>
      );
    };

    const Form = () => {
      const form = useForm({
        id: "nested-test",
        schema: z.object({
          title: z.text(),
          meta: z.object({ priority: z.text(), difficulty: z.integer() }),
        }),
        // Both the outer literal AND the nested `meta` are fresh references.
        initialValues: {
          meta: { priority: "optional", difficulty: 1 },
        },
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props}>
          <TestInput input={form.input.title} testId="nested-title" />
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);

    fireEvent.change(ui.getByTestId("nested-title"), {
      target: { value: "hello" },
    });
    fireEvent.click(ui.getByTestId("rerender"));
    fireEvent.submit(ui.getByText("Submit"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({
      title: "hello",
      meta: { priority: "optional", difficulty: 1 },
    });
  });

  it("preserves user input when initialValues contains array rebuilt each render", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const calls: Array<any> = [];

    const Parent = () => {
      const [, setTick] = useState(0);
      return (
        <>
          <button
            type="button"
            data-testid="rerender"
            onClick={() => setTick((n) => n + 1)}
          >
            Rerender
          </button>
          <Form />
        </>
      );
    };

    const Form = () => {
      const form = useForm({
        id: "array-init-test",
        schema: z.object({
          title: z.text(),
          tags: z.array(z.text()),
        }),
        // Fresh empty array reference every render — the QuestCreate case
        // for `objectives: []`.
        initialValues: { tags: [] },
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props}>
          <TestInput input={form.input.title} testId="array-init-title" />
          <button type="submit">Submit</button>
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);

    fireEvent.change(ui.getByTestId("array-init-title"), {
      target: { value: "with empty array init" },
    });
    fireEvent.click(ui.getByTestId("rerender"));
    fireEvent.submit(ui.getByText("Submit"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls[0]).toEqual({ title: "with empty array init", tags: [] });
  });

  it("DOES reinitialize when initialValues content genuinely changes (e.g. switching edit target)", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);

    // Simulates a "Edit quest A → Edit quest B" flow: parent flips between
    // two different content snapshots. The form SHOULD reflect the swap.
    const Parent = () => {
      const [which, setWhich] = useState<"A" | "B">("A");
      const target = which === "A" ? { name: "Alice" } : { name: "Bob" };
      return (
        <>
          <button
            type="button"
            data-testid="swap"
            onClick={() => setWhich((w) => (w === "A" ? "B" : "A"))}
          >
            Swap
          </button>
          <Form target={target} />
        </>
      );
    };

    const Form = ({ target }: { target: { name: string } }) => {
      const form = useForm({
        id: "swap-test",
        schema: z.object({ name: z.text() }),
        initialValues: target,
        handler: () => {},
      });
      return (
        <form {...form.props}>
          <TestInput input={form.input.name} testId="swap-name" />
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);
    const value = () => (ui.getByTestId("swap-name") as HTMLInputElement).value;

    // Starts on quest A.
    expect(value()).toBe("Alice");

    // Genuine content change — form should pick it up.
    fireEvent.click(ui.getByTestId("swap"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(value()).toBe("Bob");

    // And back.
    fireEvent.click(ui.getByTestId("swap"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(value()).toBe("Alice");
  });

  it("handles initialValues toggling between undefined and a value", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);

    const Parent = () => {
      const [show, setShow] = useState(false);
      return (
        <>
          <button
            type="button"
            data-testid="toggle"
            onClick={() => setShow((s) => !s)}
          >
            Toggle
          </button>
          <Form initial={show ? { name: "from-prop" } : undefined} />
        </>
      );
    };

    const Form = ({ initial }: { initial?: { name: string } }) => {
      const form = useForm({
        id: "toggle-init-test",
        schema: z.object({ name: z.text() }),
        initialValues: initial,
        handler: () => {},
      });
      return (
        <form {...form.props}>
          <TestInput input={form.input.name} testId="toggle-name" />
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);
    const value = () =>
      (ui.getByTestId("toggle-name") as HTMLInputElement).value;

    expect(value()).toBe("");

    // undefined → defined: should populate.
    fireEvent.click(ui.getByTestId("toggle"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(value()).toBe("from-prop");
  });

  it("does not wipe input when initialValues object literally re-equals previous one across many ticks", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let renderCount = 0;

    /**
     * Equivalent of a parent that subscribes to a frequently-firing store
     * (e.g. an atom that ticks on every mouse move). Should not damage the
     * form state at all.
     */
    const Parent = () => {
      const [tick, setTick] = useState(0);
      renderCount = tick;
      return (
        <>
          <button
            type="button"
            data-testid="burst"
            onClick={() => {
              // 5 rapid state updates in one click — React batches them
              // but each could trigger a render in dev mode.
              setTick((n) => n + 1);
              setTick((n) => n + 1);
              setTick((n) => n + 1);
              setTick((n) => n + 1);
              setTick((n) => n + 1);
            }}
          >
            Burst {tick}
          </button>
          <Form />
        </>
      );
    };

    const Form = () => {
      const form = useForm({
        id: "burst-test",
        schema: z.object({ value: z.text() }),
        initialValues: {},
        handler: () => {},
      });
      return (
        <form {...form.props}>
          <TestInput input={form.input.value} testId="burst-value" />
        </form>
      );
    };

    await alepha.start();
    const ui = renderWithAlepha(alepha, <Parent />);

    fireEvent.change(ui.getByTestId("burst-value"), {
      target: { value: "stays" },
    });
    fireEvent.click(ui.getByTestId("burst"));
    fireEvent.click(ui.getByTestId("burst"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((ui.getByTestId("burst-value") as HTMLInputElement).value).toBe(
      "stays",
    );
    expect(renderCount).toBeGreaterThan(0); // sanity: parent did re-render
  });
});
