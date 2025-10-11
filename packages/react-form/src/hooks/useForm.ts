import type { TObject } from "@alepha/core";
import { useAlepha } from "@alepha/react";
import { useId, useMemo } from "react";
import { type FormCtrlOptions, FormModel } from "../services/FormModel.ts";

/**
 * Custom hook to create a form with validation and field management.
 * This hook uses TypeBox schemas to define the structure and validation rules for the form.
 * It provides a way to handle form submission, field creation, and value management.
 *
 * @example
 * ```tsx
 * import { t } from "alepha";
 *
 * const form = useForm({
 *   schema: t.object({
 *     username: t.text(),
 *     password: t.text(),
 *   }),
 *   handler: (values) => {
 *     console.log("Form submitted with values:", values);
 *   },
 * });
 *
 * return (
 *   <form onSubmit={form.onSubmit}>
 *     <input {...form.input("username")} />
 *     <input {...form.input("password")} />
 *     <button type="submit">Submit</button>
 *   </form>
 * );
 * ```
 */
export const useForm = <T extends TObject>(
	options: FormCtrlOptions<T>,
): FormModel<T> => {
	const alepha = useAlepha();
	const formId = useId();

	return useMemo(() => {
		return alepha.inject(FormModel<T>, {
			lifetime: "transient",
			args: [options.id || formId, options],
		});
	}, []);
};
