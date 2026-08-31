import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import type { AdminDatasetDescriptor } from "alepha/api/analytics";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Database } from "lucide-react";

import { analyticsDatasetSummary } from "./analyticsModel.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";

export interface DatasetSelectProps {
  datasets: AdminDatasetDescriptor[];
  dataset: AdminDatasetDescriptor;
  onSelect: (name: string) => void;
}

/**
 * The `from` clause: which declared dataset the query reads.
 *
 * Under it, the schema in one line: the index the backend samples by, how many
 * dimensions and measures exist, and how long each tier is kept. Everything a
 * query has to respect, before it is written.
 *
 * The `Database` glyph sits on the trigger rather than on every row. All the
 * options are the same kind of thing, so repeating it once per row would
 * distinguish nothing; on the trigger it labels the control, which is the one
 * place the list is not visible.
 */
export const DatasetSelect = (props: DatasetSelectProps) => {
  const { tr } = useI18n();

  const form = useForm({
    // A plain `z.text()`, never a `z.enum(names)` built from the dataset list.
    // `useForm` anchors its schema at mount, and the list arrives from an API
    // call after the first render: an enum built from it would be frozen
    // empty, and the field would reject every value it is ever given. The
    // options are passed to `Control` as `items` instead, which is exactly
    // what that prop is for ("overrides schema enum").
    schema: datasetSchema,
    initialValues: { dataset: props.dataset.name },
    // The control is a filter, not a form: there is nothing to submit, and
    // the selection has to reach the query the moment it changes.
    onChange: (key, value) => {
      if (key === "dataset" && value) props.onSelect(String(value));
    },
    handler: () => {},
  });

  return (
    <div className="flex flex-col gap-1.5">
      <ClauseLabel>from</ClauseLabel>
      <Control
        input={form.input.dataset}
        label=""
        icon={Database}
        triggerClassName="bg-muted dark:bg-muted w-full font-mono text-[12.5px] font-medium"
        items={props.datasets.map((entry) => ({
          label: entry.name,
          value: entry.name,
        }))}
        inputProps={{
          "aria-label": tr("admin.analytics.pickDataset", {
            default: "Pick a dataset",
          }),
        }}
      />
      <div className="text-muted-foreground text-[10.5px] leading-normal">
        {analyticsDatasetSummary(props.dataset)}
      </div>
    </div>
  );
};

/**
 * Module-level so the reference is stable: `useForm` memoizes its model on the
 * dependency list, and a schema rebuilt each render would be a new object the
 * form never picks up anyway.
 */
const datasetSchema = z.object({ dataset: z.text() });
