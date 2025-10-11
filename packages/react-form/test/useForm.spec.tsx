import { Alepha, t } from "@alepha/core";
import { AlephaLogger } from "@alepha/logger";
import { AlephaContext } from "@alepha/react";
import { dom } from "@alepha/testing";
import type { ReactNode } from "react";
import { describe, it, vi } from "vitest";
import { useForm } from "../src";

/**
 * @vitest-environment jsdom
 */

describe("useForm", () => {
	const renderWithAlepha = (alepha: Alepha, element: ReactNode) => {
		return dom.render(
			<AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
		);
	};

	it("should run handler on submit", async ({ expect }) => {
		const alepha = Alepha.create().with(AlephaLogger);
		const fn = vi.fn();
		const calls: Array<any> = [];
		const Form = () => {
			const form = useForm({
				id: "test",
				schema: t.object({
					str: t.text(),
					int: t.int(),
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
				<form onSubmit={form.onSubmit} data-testid="test-form">
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

		dom.fireEvent.change(ui.getByTestId("test-str"), {
			target: { value: "testuser" },
		});

		dom.fireEvent.change(ui.getByTestId("test-int"), {
			target: { value: "123" },
		});

		dom.fireEvent.change(ui.getByTestId("test-nested.str"), {
			target: { value: "nestedvalue" },
		});

		dom.fireEvent.change(ui.getByTestId("test-nested.another.level"), {
			target: { value: "anothervalue" },
		});

		dom.fireEvent.submit(ui.getByText("Submit"));

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
