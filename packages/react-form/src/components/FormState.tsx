import type { TObject } from "@alepha/core";
import type { ReactNode } from "react";
import { useFormState } from "../hooks/useFormState.ts";
import type { FormCtrl } from "../services/FormCtrl.ts";

const FormState = <T extends TObject>(props: {
	form: FormCtrl<T>;
	children: (state: { loading: boolean; dirty: boolean }) => ReactNode;
}) => {
	const formState = useFormState(props.form);
	return props.children({
		loading: formState.loading,
		dirty: formState.dirty,
	});
};

export default FormState;
