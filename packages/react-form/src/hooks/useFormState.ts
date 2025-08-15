import type { TObject } from "@alepha/core";
import { useAlepha } from "@alepha/react";
import { useEffect, useState } from "react";
import type { FormCtrl } from "../services/FormCtrl.ts";

export interface UseFormStateReturn<T extends TObject> {
	loading: boolean;
	dirty: boolean;
	values?: T;
	error?: Error;
}

export const useFormState = <T extends TObject>(
	form: FormCtrl<T>,
): UseFormStateReturn<T> => {
	const alepha = useAlepha();

	const [dirty, setDirty] = useState(false);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const listeners: Function[] = [];

		listeners.push(
			alepha.on("form:change", (event) => {
				if (event.id === form.id) {
					setDirty(true);
				}
			}),
		);

		listeners.push(
			alepha.on("form:submit:begin", (event) => {
				if (event.id === form.id) {
					setDirty(false);
					setLoading(true);
				}
			}),
		);

		listeners.push(
			alepha.on("form:submit:end", (event) => {
				if (event.id === form.id) {
					setLoading(false);
				}
			}),
		);

		return () => {
			for (const unsub of listeners) {
				unsub();
			}
		};
	}, []);

	return {
		dirty,
		loading,
	};
};
