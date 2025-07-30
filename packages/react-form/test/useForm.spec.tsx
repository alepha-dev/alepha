import { Alepha, t } from "@alepha/core";
import { AlephaContext } from "@alepha/react";
import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, vi } from "vitest";
import { useForm } from "../src";

/**
 * @vitest-environment jsdom
 */

describe("useForm", () => {
	const renderWithAlepha = (alepha: Alepha, element: ReactNode) => {
		return render(
			<AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
		);
	};

	it("should run handler on submit", ({ expect }) => {
		const alepha = Alepha.create();
		const fn = vi.fn();
		const Form = () => {
			const form = useForm({
				id: "test",
				schema: t.object({
					str: t.string(),
					int: t.int(),
					nested: t.object({
						str: t.string(),
						another: t.object({
							level: t.string(),
						}),
					}),
				}),
				handler: fn,
			});

			return (
				<form onSubmit={form.onSubmit} data-testid="test-form">
					<input {...form.input.str} />
					<input {...form.input.int} />
					<input {...form.input.nested.str} />
					<input {...form.input.nested.another.level} />
					<button type="submit">Submit</button>
				</form>
			);
		};

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

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(
			{
				str: "testuser",
				int: 123,
				nested: {
					str: "nestedvalue",
					another: {
						level: "anothervalue",
					},
				},
			},
			{
				form: ui.getByTestId("test-form"),
			},
		);
	});
});
