import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import type { SchemaControlFn } from "alepha/react/ui";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * A whole form from one flat schema: layout, labels, widths, validation and
 * the submit bar, none of them written by hand.
 *
 * The knobs are `AutoForm`'s own chrome, so the same schema can be seen as a
 * page form, a settings card and an auto-saving panel without the schema
 * changing at all.
 */
const KNOBS = z.object({
  layout: z.enum(["stack", "row"]).default("stack").meta({ title: "layout" }),
  card: z.boolean().default(false).meta({ title: "card" }),
  autoSave: z.boolean().default(false).meta({ title: "autoSave" }),
  header: z.boolean().default(true).meta({ title: "Header" }),
  noSubmit: z.boolean().default(false).meta({ title: "noSubmit" }),
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
});

/**
 * ⚠️ A function `$control` receives `{ form }` and HIDES its field by returning
 * `false`. There is no `hidden` key; getting that wrong means the field never
 * appears at all.
 */
const schema = z.object({
  projectName: z
    .string()
    .meta({ title: "Project name", $control: { width: 100 } })
    .describe("Shown everywhere the project is referenced."),
  role: z
    .enum(["viewer", "admin"])
    .default("viewer")
    .meta({ title: "Role", $control: { width: 50 } }),
  apiToken: z
    .string()
    .meta({
      title: "Api Token",
      $control: (({ form }) => {
        const role = (form.currentValues as { role?: string }).role;
        // `hidden`, not `false`: the half-row stays reserved while Role is
        // anything else, so nothing around it moves when the field arrives.
        if (role !== "admin") return { hidden: true, width: 50 };
        return { icon: "key", password: true, width: 50 };
      }) satisfies SchemaControlFn,
    })
    .optional(),
  region: z
    .enum(["eu-west", "us-east", "ap-south"])
    .meta({ title: "Region", $control: { width: 50 } }),
  replicas: z.number().meta({ title: "Replicas", $control: { width: 50 } }),
  // Both declare a width for the same reason every field above does: the
  // default heuristic is 33%, so a pair of them makes a 4+4 row with a third
  // of it empty, beside 6+6 rows either side.
  autoScale: z
    .boolean()
    .default(false)
    .meta({ title: "Autoscale", $control: { width: 50 } }),
  maintenanceAt: z
    .string()
    .meta({
      format: "date-time",
      title: "Maintenance window",
      $control: { width: 50 },
    })
    .optional(),
  notes: z
    .string()
    .meta({ title: "Notes", $control: { width: 100 } })
    .optional(),
});

const Basic = () => {
  const toast = useToast();
  const form = useForm(
    {
      schema,
      handler: (values) => toast.success(JSON.stringify(values, null, 2)),
    },
    [schema],
  );

  return (
    <Showcase
      id="blocks/auto-form/Basic"
      title="AutoForm"
      description="A whole form rendered from a flat schema."
      schema={KNOBS}
      initialValues={{
        layout: "stack",
        card: false,
        autoSave: false,
        header: true,
        noSubmit: false,
        disabled: false,
      }}
    >
      {(v) => (
        <div className="mx-auto max-w-3xl">
          <AutoForm
            // `layout`, `card` and `autoSave` are read as the form is built,
            // so a remount is what makes them live knobs rather than dead ones.
            key={`${v.layout}-${v.card}-${v.autoSave}`}
            form={form}
            layout={v.layout}
            card={v.card}
            autoSave={v.autoSave}
            noSubmit={v.noSubmit}
            disabled={v.disabled}
            title={v.header ? "Project settings" : undefined}
            description={
              v.header
                ? "Switch Role to admin and the Api Token field appears."
                : undefined
            }
            submitLabel="Save settings"
          />
        </div>
      )}
    </Showcase>
  );
};

export default Basic;
