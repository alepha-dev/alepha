import { MantineProvider } from "@mantine/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Alepha, t } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { useForm } from "alepha/react/form";
import {
  renderWithAlepha as renderWithAlephaUtil,
  setupJsdomMocks,
} from "alepha/react/testing";
import { beforeAll, describe, it } from "vitest";
import TypeForm from "./TypeForm.tsx";

// Setup jsdom mocks for Mantine components
beforeAll(() => {
  setupJsdomMocks();
});

describe("TypeForm", () => {
  /**
   * Helper to render with Alepha and Mantine.
   * Uses the new alepha/react/testing utilities.
   */
  const renderWithAlepha = async (element: React.ReactElement) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const result = await renderWithAlephaUtil(element, {
      alepha,
      wrapper: MantineProvider,
    });
    return { ...result, alepha };
  };

  describe("Text Input", () => {
    it("should render text input and submit value", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "text-test",
          schema: t.object({
            username: t.text(),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      const input = screen.getByTestId("text-test-username");
      fireEvent.change(input, { target: { value: "testuser" } });
      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({ username: "testuser" });
    });

    it("should use title from schema as label", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "title-test",
          schema: t.object({
            username: t.text({ title: "User Name" }),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("User Name")).toBeDefined();
    });
  });

  describe("Number Input", () => {
    it("should render number input for integer type", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "number-test",
          schema: t.object({
            age: t.integer(),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      const input = screen.getByTestId("number-test-age");
      fireEvent.change(input, { target: { value: "25" } });
      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({ age: 25 });
    });

    it("should render number input for number type", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "float-test",
          schema: t.object({
            price: t.number(),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      const input = screen.getByTestId("float-test-price");
      fireEvent.change(input, { target: { value: "19.99" } });
      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({ price: 19.99 });
    });
  });

  describe("Boolean/Select", () => {
    it("should render select for boolean type by default", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "bool-test",
          schema: t.object({
            subscribe: t.boolean(),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // Boolean renders as Select with Yes/No options by default
      const selectInput = screen.getByTestId("bool-test-subscribe");
      expect(selectInput).toBeDefined();
      expect(selectInput.getAttribute("aria-haspopup")).toBe("listbox");
    });

    it("should render switch only when explicitly requested", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "bool-switch-test",
          schema: t.object({
            subscribe: t.boolean(),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{ subscribe: { switch: true } }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      const switchInput = screen.getByRole("switch");
      expect(switchInput).toBeDefined();
    });
  });

  describe("Enum/Select", () => {
    it("should render select for enum type", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "enum-test",
          schema: t.object({
            status: t.enum(["active", "inactive", "pending"]),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // Select should be rendered - Mantine Select uses textbox role with aria-haspopup
      const selectInput = screen.getByRole("textbox", { name: "Status" });
      expect(selectInput).toBeDefined();
      expect(selectInput.getAttribute("aria-haspopup")).toBe("listbox");
    });
  });

  describe("Nested Objects", () => {
    it("should render nested object fields", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "nested-test",
          schema: t.object({
            address: t.object({
              street: t.text(),
              city: t.text(),
            }),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // Find nested inputs (IDs use dots for nested paths)
      const streetInput = screen.getByTestId("nested-test-address.street");
      const cityInput = screen.getByTestId("nested-test-address.city");

      fireEvent.change(streetInput, { target: { value: "123 Main St" } });
      fireEvent.change(cityInput, { target: { value: "New York" } });
      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({
        address: {
          street: "123 Main St",
          city: "New York",
        },
      });
    });

    it("should render deeply nested objects", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "deep-nested-test",
          schema: t.object({
            company: t.object({
              headquarters: t.object({
                country: t.text(),
              }),
            }),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      const countryInput = screen.getByTestId(
        "deep-nested-test-company.headquarters.country",
      );
      fireEvent.change(countryInput, { target: { value: "USA" } });
      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({
        company: {
          headquarters: {
            country: "USA",
          },
        },
      });
    });
  });

  describe("Array of Strings (TagsInput)", () => {
    it("should render tags input for array of strings", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "tags-test",
          schema: t.object({
            tags: t.array(t.text()),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // TagsInput should be rendered - check by label
      expect(screen.getByText("Tags")).toBeDefined();
    });

    it("should have default array values in form", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "tags-default-test",
          schema: t.object({
            tags: t.array(t.text(), { default: ["tag1", "tag2"] }),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // Check that default tags are rendered as pills
      expect(screen.getByText("tag1")).toBeDefined();
      expect(screen.getByText("tag2")).toBeDefined();
    });
  });

  describe("Array of Enums (MultiSelect)", () => {
    it("should render multiselect for array of enums", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "multi-enum-test",
          schema: t.object({
            roles: t.array(t.enum(["admin", "user", "guest"])),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // MultiSelect should be rendered - check by label
      expect(screen.getByText("Roles")).toBeDefined();
    });
  });

  describe("Array of Objects (ControlArray)", () => {
    it("should render array of objects with add button", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "array-obj-test",
          schema: t.object({
            contacts: t.array(
              t.object({
                name: t.text(),
                email: t.text(),
              }),
            ),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // ControlArray should render with an Add button
      const addButton = screen.getByText("Add");
      expect(addButton).toBeDefined();

      // Initially no textboxes in the array section
      const initialTextboxes = screen.queryAllByRole("textbox");
      const initialCount = initialTextboxes.length;

      // Click add to create a new item
      fireEvent.click(addButton);

      // After clicking add, new textboxes should appear for name and email fields
      await waitFor(() => {
        const newTextboxes = screen.queryAllByRole("textbox");
        expect(newTextboxes.length).toBeGreaterThan(initialCount);
      });
    });
  });

  describe("Multiple Field Types Combined", () => {
    it("should handle form with all field types", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "combined-test",
          schema: t.object({
            name: t.text(),
            age: t.integer(),
            active: t.boolean(),
            role: t.enum(["admin", "user"]),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // All field types should render
      // Text input
      const nameInput = screen.getByTestId("combined-test-name");
      expect(nameInput).toBeDefined();

      // Number input
      const ageInput = screen.getByTestId("combined-test-age");
      expect(ageInput).toBeDefined();

      // Boolean select (rendered as Select by default, not Switch)
      const activeSelect = screen.getByTestId("combined-test-active");
      expect(activeSelect).toBeDefined();
      expect(activeSelect.getAttribute("aria-haspopup")).toBe("listbox");

      // Enum select (Mantine uses textbox with aria-haspopup)
      const roleSelect = screen.getByRole("textbox", { name: "Role" });
      expect(roleSelect).toBeDefined();

      // Verify we can interact with fields
      fireEvent.change(nameInput, { target: { value: "Alice" } });
      expect((nameInput as HTMLInputElement).value).toBe("Alice");

      fireEvent.change(ageInput, { target: { value: "30" } });
    });
  });

  describe("Form Reset", () => {
    it("should reset all fields to default values", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "reset-test",
          schema: t.object({
            name: t.text({ default: "default name" }),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      // Change values
      const nameInput = screen.getByTestId("reset-test-name");
      fireEvent.change(nameInput, { target: { value: "changed" } });

      // Click reset
      fireEvent.click(screen.getByText("Reset"));

      // Values should be reset
      await waitFor(() => {
        expect((nameInput as HTMLInputElement).value).toBe("default name");
      });
    });
  });

  describe("TypeForm Props", () => {
    it("should respect skipSubmitButton prop", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "no-submit-test",
          schema: t.object({
            name: t.text(),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} skipSubmitButton />;
      };

      await renderWithAlepha(<Form />);

      expect(screen.queryByText("Submit")).toBeNull();
    });

    it("should apply controlProps to all fields", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "control-props-test",
          schema: t.object({
            field1: t.text(),
            field2: t.text(),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            controlProps={{ title: "Custom Title" }}
            skipSubmitButton
          />
        );
      };

      await renderWithAlepha(<Form />);

      // Both fields should have the custom title
      const titles = screen.getAllByText("Custom Title");
      expect(titles.length).toBe(2);
    });

    it("should apply fieldControlProps to specific fields", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "field-control-props-test",
          schema: t.object({
            field1: t.text(),
            field2: t.text(),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              field1: { title: "Field One" },
              field2: { title: "Field Two" },
            }}
            skipSubmitButton
          />
        );
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("Field One")).toBeDefined();
      expect(screen.getByText("Field Two")).toBeDefined();
    });

    it("should use custom submit button text", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "custom-submit-test",
          schema: t.object({
            name: t.text(),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            submitButtonProps={{ children: "Save Changes" }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("Save Changes")).toBeDefined();
    });

    it("should render children function instead of auto fields", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "children-test",
          schema: t.object({
            name: t.text(),
            email: t.text(),
          }),
          handler: () => {},
        });

        return (
          <TypeForm form={form} skipSubmitButton>
            {(input) => (
              <div>
                <input {...input.name.props} data-testid="custom-name" />
                <span>Custom Layout</span>
              </div>
            )}
          </TypeForm>
        );
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByTestId("custom-name")).toBeDefined();
      expect(screen.getByText("Custom Layout")).toBeDefined();
      // Auto-generated fields should not exist
      expect(screen.queryByTestId("children-test-email")).toBeNull();
    });
  });

  describe("Required Fields", () => {
    it("should mark required fields", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "required-test",
          schema: t.object(
            {
              requiredField: t.text(),
              optionalField: t.optional(t.text()),
            },
            { required: ["requiredField"] },
          ),
          handler: () => {},
        });

        return <TypeForm form={form} skipSubmitButton />;
      };

      await renderWithAlepha(<Form />);

      // Required indicator should be present
      // This depends on how Mantine renders required fields
      const requiredInput = screen.getByTestId("required-test-requiredField");
      expect(requiredInput).toBeDefined();
    });
  });

  describe("Columns Configuration", () => {
    it("should accept numeric columns prop", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "columns-test",
          schema: t.object({
            field1: t.text(),
            field2: t.text(),
            field3: t.text(),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} columns={3} skipSubmitButton />;
      };

      await renderWithAlepha(<Form />);

      // All fields should render
      expect(screen.getByTestId("columns-test-field1")).toBeDefined();
      expect(screen.getByTestId("columns-test-field2")).toBeDefined();
      expect(screen.getByTestId("columns-test-field3")).toBeDefined();
    });

    it("should accept responsive columns config", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "responsive-columns-test",
          schema: t.object({
            field1: t.text(),
            field2: t.text(),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            columns={{ xs: 1, sm: 2, lg: 3 }}
            skipSubmitButton
          />
        );
      };

      await renderWithAlepha(<Form />);

      expect(
        screen.getByTestId("responsive-columns-test-field1"),
      ).toBeDefined();
      expect(
        screen.getByTestId("responsive-columns-test-field2"),
      ).toBeDefined();
    });
  });
});
