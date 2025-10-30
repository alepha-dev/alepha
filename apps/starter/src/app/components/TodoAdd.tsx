import { t } from "@alepha/core";
import { useClient, useRouter } from "@alepha/react";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import type { TaskController } from "../../api/controllers/TaskController.ts";
import type { AppI18n } from "../AppI18n.ts";
import type { AppRouter } from "../AppRouter.ts";

const TodoAdd = () => {
  const router = useRouter<AppRouter>();
  const client = useClient<TaskController>();
  const { tr } = useI18n<AppI18n, "en">();

  const form = useForm({
    schema: t.object({
      name: t.string(),
    }),
    handler: async (body) => {
      await client.createTask({ body });
      await router.go("home");
    },
  });

  return (
    <div>
      <h2>{tr("addTask.title")}</h2>
      <form {...form.props}>
        <input
          {...form.input.name.props}
          placeholder={tr("addTask.placeholder")}
        />
        <button type="submit">{tr("addTask.submitButton")}</button>
      </form>
    </div>
  );
};

export default TodoAdd;
