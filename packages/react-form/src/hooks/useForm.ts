import type { Static, TObject } from "@alepha/core";

export type UseFormOptions<T extends TObject> = {
	schema: T;
	onSubmit?: (values: Static<T>) => void;
	onValuesChange?: (values: Static<T>, previous: Static<T>) => void;
	initialValues?: Static<T>;
};

export type UseFormReturn<T extends TObject> = {
	form: {};
};

export const useForm = <T extends TObject>(
	options: UseFormOptions<T>,
): UseFormReturn<T> => {
	return {
		form: {},
	};
};
