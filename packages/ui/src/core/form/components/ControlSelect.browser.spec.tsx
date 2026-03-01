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

beforeAll(() => {
  setupJsdomMocks();

  // Mantine combobox calls scrollIntoView on options which is not available in jsdom
  Element.prototype.scrollIntoView = () => {};
});

describe("ControlSelect", () => {
  const renderWithAlepha = async (element: React.ReactElement) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const result = await renderWithAlephaUtil(element, {
      alepha,
      wrapper: MantineProvider,
    });
    return { ...result, alepha };
  };

  describe("Select (single enum)", () => {
    it("should render a select input for an enum field", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "select-test",
          schema: t.object({
            color: t.enum(["red", "green", "blue"]),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      const selectInput = screen.getByTestId("select-test-color");
      expect(selectInput).toBeDefined();
      expect(selectInput.getAttribute("aria-haspopup")).toBe("listbox");
    });

    it("should submit the selected value", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "select-submit-test",
          schema: t.object({
            color: t.enum(["red", "green", "blue"]),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      const selectInput = screen.getByTestId("select-submit-test-color");
      fireEvent.click(selectInput);

      // Mantine dropdown is rendered but hidden in jsdom — query options directly
      const option = document.querySelector(
        '[role="option"][value="red"]',
      ) as HTMLElement;
      expect(option).toBeDefined();
      fireEvent.click(option);

      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({ color: "red" });
    });
  });

  describe("MultiSelect (array of enums)", () => {
    it("should render a multiselect for an array of enums", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "multi-test",
          schema: t.object({
            roles: t.array(t.enum(["admin", "editor", "viewer"])),
          }),
          handler: () => {},
        });

        return <TypeForm form={form} />;
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("Roles")).toBeDefined();

      // MultiSelect does not propagate data-testid; verify via input id
      const input = document.getElementById("multi-test-roles") as HTMLElement;
      expect(input).toBeDefined();
      expect(input.getAttribute("aria-haspopup")).toBe("listbox");
    });
  });

  describe("Autocomplete (creatable + single)", () => {
    it("should render an autocomplete when creatable is true", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "autocomplete-test",
          schema: t.object({
            fruit: t.enum(["apple", "banana", "cherry"]),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              fruit: { select: { creatable: true } },
            }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      // Autocomplete renders inside an Autocomplete-root wrapper
      const root = document.querySelector(
        ".mantine-Autocomplete-root",
      ) as HTMLElement;
      expect(root).toBeDefined();

      // The input element has the id and role=combobox
      const input = document.getElementById(
        "autocomplete-test-fruit",
      ) as HTMLElement;
      expect(input).toBeDefined();
      expect(input.tagName).toBe("INPUT");
    });

    it("should accept a typed freeform value", async ({ expect }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "autocomplete-freeform-test",
          schema: t.object({
            fruit: t.text(),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              fruit: {
                select: {
                  creatable: true,
                  autocompleteProps: {
                    data: ["apple", "banana", "cherry"],
                  },
                },
              },
            }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      const input = document.getElementById(
        "autocomplete-freeform-test-fruit",
      ) as HTMLInputElement;
      expect(input).toBeDefined();

      fireEvent.change(input, { target: { value: "mango" } });
      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({ fruit: "mango" });
    });
  });

  describe("TagsInput (creatable + array)", () => {
    it("should render tags input for creatable array of enums", async ({
      expect,
    }) => {
      const Form = () => {
        const form = useForm({
          id: "tags-test",
          schema: t.object({
            skills: t.array(t.enum(["js", "ts", "python"])),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              skills: { select: { creatable: true } },
            }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("Skills")).toBeDefined();
    });

    it("should show default tag pills", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "tags-default-test",
          schema: t.object({
            skills: t.array(t.enum(["js", "ts", "python"]), {
              default: ["js", "ts"],
            }),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              skills: { select: { creatable: true } },
            }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("js")).toBeDefined();
      expect(screen.getByText("ts")).toBeDefined();
    });
  });

  describe("SegmentedControl", () => {
    it("should render segmented control with enum data", async ({ expect }) => {
      const Form = () => {
        const form = useForm({
          id: "segmented-test",
          schema: t.object({
            size: t.enum(["small", "medium", "large"]),
          }),
          handler: () => {},
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              size: { segmented: true },
            }}
            skipSubmitButton
          />
        );
      };

      await renderWithAlepha(<Form />);

      expect(screen.getByText("small")).toBeDefined();
      expect(screen.getByText("medium")).toBeDefined();
      expect(screen.getByText("large")).toBeDefined();
    });
  });

  describe("Numeric coercion", () => {
    it("should coerce select value to number for integer schema", async ({
      expect,
    }) => {
      const calls: Array<any> = [];

      const Form = () => {
        const form = useForm({
          id: "numeric-test",
          schema: t.object({
            priority: t.integer({ enum: [1, 2, 3] }),
          }),
          handler: (values) => {
            calls.push(values);
          },
        });

        return (
          <TypeForm
            form={form}
            fieldControlProps={{
              priority: {
                select: {
                  selectProps: {
                    data: [
                      { value: "1", label: "Low" },
                      { value: "2", label: "Medium" },
                      { value: "3", label: "High" },
                    ],
                  },
                },
              },
            }}
          />
        );
      };

      await renderWithAlepha(<Form />);

      const selectInput = screen.getByTestId("numeric-test-priority");
      expect(selectInput).toBeDefined();

      fireEvent.click(selectInput);

      // Query options directly since Mantine dropdown is hidden in jsdom
      const option = document.querySelector(
        '[role="option"][value="2"]',
      ) as HTMLElement;
      expect(option).toBeDefined();
      fireEvent.click(option);

      fireEvent.submit(screen.getByText("Submit"));

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toEqual({ priority: 2 });
    });
  });
});
