import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import type { SchemaControlFn } from "alepha/react/ui";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * A whole form from one schema: layout, labels, validation, the submit bar.
 *
 * The knobs are AutoForm's own chrome - the header, the layout, whether it
 * saves as you type - so the same schema can be seen as a page form, a settings
 * card, and an auto-saving panel without touching the schema.
 */
const KNOBS = z.object({
  layout: z.enum(["stack", "row"]).default("stack").meta({ title: "layout" }),
  card: z.boolean().default(false).meta({ title: "card" }),
  autoSave: z.boolean().default(false).meta({ title: "autoSave" }),
  header: z.boolean().default(true).meta({ title: "Header" }),
  noSubmit: z.boolean().default(false).meta({ title: "noSubmit" }),
  autoGroup: z.boolean().default(false).meta({ title: "autoGroup" }),
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
        if (role !== "admin") return false;
        return { icon: "key", password: true, width: 50 };
      }) satisfies SchemaControlFn,
    })
    .optional(),
  region: z
    .enum(["eu-west", "us-east", "ap-south"])
    .meta({ title: "Region", $control: { width: 50 } }),
  replicas: z.number().meta({ title: "Replicas", $control: { width: 50 } }),
  autoScale: z.boolean().default(false).meta({ title: "Autoscale" }),
  maintenanceAt: z
    .string()
    .meta({ format: "date-time", title: "Maintenance window" })
    .optional(),
  tags: z.array(z.string()).meta({ title: "Tags" }),
  contact: z
    .object({
      email: z.string().meta({ format: "email", title: "Email" }),
      phone: z.string().meta({ title: "Phone" }).optional(),
    })
    .meta({ title: "Contact" })
    .optional(),
  notes: z
    .string()
    .meta({ title: "Notes", $control: { width: 100 } })
    .optional(),
});

const AutoFormBlock = () => {
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
      title="AutoForm"
      description="A whole form rendered from a zod schema."
      schema={KNOBS}
      initialValues={{
        layout: "stack",
        card: false,
        autoSave: false,
        header: true,
        noSubmit: false,
        autoGroup: false,
      }}
    >
      {(v) => (
        <div className="mx-auto max-w-3xl">
          <AutoForm
            key={`${v.layout}-${v.card}-${v.autoSave}-${v.autoGroup}`}
            form={form}
            layout={v.layout}
            card={v.card}
            autoSave={v.autoSave}
            noSubmit={v.noSubmit}
            autoGroup={v.autoGroup}
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

export default AutoFormBlock;
