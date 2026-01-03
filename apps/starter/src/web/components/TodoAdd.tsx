import { useClient } from "@alepha/react";
import { useForm, useFormState } from "@alepha/react/form";
import { Localize, useI18n } from "@alepha/react/i18n";
import { useRouter } from "@alepha/react/router";
import { Flex } from "@alepha/ui";
import { Alert, Button, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconPlus } from "@tabler/icons-react";
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

  const state = useFormState(form, ["error", "loading"]);

  return (
    <Flex direction="column" gap="md">
      <Title order={3}>{tr("addTask.title")}</Title>

      <form {...form.props}>
        <Flex direction="column" gap="sm">
          <TextInput
            {...form.input.name.props}
            placeholder={tr("addTask.placeholder")}
            label={tr("addTask.label")}
          />

          {state.error && state.error instanceof TypeBoxError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red">
              <Localize value={state.error} />
            </Alert>
          )}

          <Button
            type="submit"
            leftSection={<IconPlus size={16} />}
            loading={state.loading}
          >
            {tr("addTask.submitButton")}
          </Button>
        </Flex>
      </form>
    </Flex>
  );
};

export default TodoAdd;
