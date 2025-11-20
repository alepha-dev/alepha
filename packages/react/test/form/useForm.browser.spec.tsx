import { AlephaContext } from "@alepha/react";
import { fireEvent, render } from "@testing-library/react";
import { Alepha, t } from "alepha";
import { AlephaLogger } from "alepha/logger";
import type { ReactNode } from "react";
import { describe, it } from "vitest";
import { useForm } from "../../src/form/index.ts";

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
          <input {...form.input.nested.str.props} />
          <input {...form.input.nested.another.level.props} />
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
});
