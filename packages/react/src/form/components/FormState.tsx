import type { TObject } from "alepha";
import type { ReactNode } from "react";
import { useFormState } from "../hooks/useFormState.ts";
import type { FormModel } from "../services/FormModel.ts";

const FormState = <T extends TObject>(props: {
  form: FormModel<T>;
  children: (state: { loading: boolean; dirty: boolean }) => ReactNode;
}) => {
  const formState = useFormState(props.form);
  return props.children({
    loading: formState.loading,
    dirty: formState.dirty,
  });
};

export default FormState;
