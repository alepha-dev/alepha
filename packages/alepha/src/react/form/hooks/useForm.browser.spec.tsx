import { fireEvent, render } from "@testing-library/react";
import { Alepha, t } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { describe, it } from "vitest";
import { useForm } from "../index.ts";

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
        schema: t.object({
          str: t.text(),
          int: t.integer(),
          nested: t.object({
            str: t.text(),
            another: t.object({
              level: t.text(),
            }),
          }),
        }),
        handler: (values, args) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="test-form">
          <input {...form.input.str.props} />
          <input {...form.input.int.props} />
          <input {...form.input.nested.items.str.props} />
          <input {...form.input.nested.items.another.items.level.props} />
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
        schema: t.object({
          name: t.text(),
          address: t.object({
            street: t.text(),
            city: t.text(),
            country: t.object({
              code: t.text(),
              name: t.text(),
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
        schema: t.object({
          tags: t.array(t.text()),
          contacts: t.array(
            t.object({
              name: t.text(),
              email: t.text(),
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
        schema: t.object({
          tags: t.array(t.text()),
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
        schema: t.object({
          contacts: t.array(
            t.object({
              name: t.text(),
              email: t.text(),
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
        schema: t.object({
          company: t.object({
            name: t.text(),
            address: t.object({
              street: t.text(),
              city: t.text(),
            }),
          }),
          employees: t.array(
            t.object({
              name: t.text(),
              role: t.text(),
            }),
          ),
        }),
        handler: (values) => {
          calls.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="complex-form">
          <input {...form.input.company.items.name.props} />
          <input {...form.input.company.items.address.items.street.props} />
          <input {...form.input.company.items.address.items.city.props} />
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
});
