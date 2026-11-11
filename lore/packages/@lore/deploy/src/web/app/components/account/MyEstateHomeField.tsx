import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { estateHomeFormSchema } from "../shared/estateHomeFormSchema.ts";

export interface MyEstateHomeFieldProps {
  /**
   * The projects the caller may create an estate in, from
   * `listEstateHomeChoices`.
   */
  projects: Array<{ id: number; title: string }>;
  value: number | undefined;
  onChange: (projectId: number) => void;
  busy: boolean;
}

/**
 * Which project a new estate belongs to (#E126). A select when there is a
 * choice, a line of text when there is one candidate: a picker with one item
 * asks a question that has only one answer.
 *
 * A one-field form, for the reason `EstateCreateFields` gives: `Control`
 * binds to a form field, and the dialog owns the value.
 */
const MyEstateHomeField = (props: MyEstateHomeFieldProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [initialValues] = useState(() => ({
    projectId: props.value === undefined ? "" : String(props.value),
  }));
  const form = useForm({
    schema: estateHomeFormSchema,
    initialValues,
    handler: () => undefined,
    onChange: (_key, value) => {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0) props.onChange(id);
    },
  });

  if (props.projects.length === 1) {
    return (
      <p className="text-sm" data-testid="estate-create-project-only">
        {tr("account.estates.create.project.only", {
          args: [props.projects[0]!.title],
        })}
      </p>
    );
  }

  return (
    <Control
      select
      input={form.input.projectId}
      label={tr("account.estates.create.project")}
      description={tr("account.estates.create.project.description")}
      disabled={props.busy}
      items={props.projects.map((project) => ({
        value: String(project.id),
        label: project.title,
      }))}
      data-testid="estate-create-project"
    />
  );
};

export default MyEstateHomeField;
