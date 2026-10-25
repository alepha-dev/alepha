import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";

export interface StackCreateFormProps {
  projectId: number;
  estates: Array<{ id: string; slug: string; label?: string }>;
}

/**
 * A new stack: its name (the project slug when empty) and its default estate.
 */
const StackCreateForm = (props: StackCreateFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const stackApi = useClient<StackController>();
  const queries = useQueryClient();

  const form = useForm({
    id: "stack-create",
    schema: z.object({
      name: z.string().max(64).optional(),
      estateId: z.string().optional(),
    }),
    initialValues: { name: "", estateId: "" },
    handler: async (input) => {
      await stackApi.createStack({
        params: { projectId: props.projectId },
        body: {
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          ...(input.estateId ? { estateId: input.estateId } : {}),
        },
      });
      queries.invalidate(["stacks", props.projectId]);
      form.reset();
      toaster.success(tr("stacks.created"));
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("stacks.create")}</CardTitle>
        <CardDescription>{tr("stacks.create.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <div className="flex-1" data-testid="stack-create-name">
            <Control input={form.input.name} label={tr("stacks.create.name")} />
          </div>
          <div className="flex-1" data-testid="stack-create-estate">
            <Control
              select
              input={form.input.estateId}
              label={tr("stacks.create.estate")}
              items={props.estates.map((estate) => ({
                value: estate.id,
                label: estate.label
                  ? `${estate.slug} (${estate.label})`
                  : estate.slug,
              }))}
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            data-testid="stack-create-submit"
          >
            {tr("stacks.create.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default StackCreateForm;
