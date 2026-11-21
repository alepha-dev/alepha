import type { ZObject } from "alepha";
import type { ReactNode } from "react";

import { useFormState } from "../hooks/useFormState.ts";
import type { FormModel } from "../services/FormModel.ts";

export interface FormStateProps<T extends ZObject> {
  form: FormModel<T>;
  children: (state: { loading: boolean; dirty: boolean }) => ReactNode;
}

const FormState = <T extends ZObject>(props: FormStateProps<T>) => {
  const formState = useFormState(props.form);
  return props.children({
    loading: formState.loading,
    dirty: formState.dirty,
  });
};

export default FormState;
