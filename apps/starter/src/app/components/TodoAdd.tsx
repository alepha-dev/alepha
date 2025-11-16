import { useClient, useRouter } from "@alepha/react";
import { useForm, useFormState } from "@alepha/react/form";
import { Localize, useI18n } from "@alepha/react/i18n";
import { TypeBoxError, t } from "alepha";
import type { TaskController } from "../../api/controllers/TaskController.ts";
import type { AppI18n } from "../AppI18n.ts";
import type { AppRouter } from "../AppRouter.ts";

const TodoAdd = () => {
  const router = useRouter<AppRouter>();
  const client = useClient<TaskController>();
  const { tr } = useI18n<AppI18n, "en">();

  const form = useForm({
    schema: t.object({
      name: t.string({
        minLength: 3,
      }),
    }),
    handler: async (body) => {
      await client.createTask({ body });
      await router.go("home");
    },
  });

  const state = useFormState(form, ["error"]);

  return (
    <div>
      <h2>{tr("addTask.title")}</h2>
      <form {...form.props}>
        <input
          {...form.input.name.props}
          placeholder={tr("addTask.placeholder")}
        />
        {state.error && state.error instanceof TypeBoxError && (
          <Localize value={state.error} />
        )}
        <button type="submit">{tr("addTask.submitButton")}</button>
      </form>
    </div>
  );
};

export default TodoAdd;
