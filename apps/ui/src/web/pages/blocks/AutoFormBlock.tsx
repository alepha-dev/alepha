import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import type { SchemaControlFn } from "alepha/react/ui";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * Module scope so `useForm` anchors it once. See `Controls.tsx`.
 *
 * `apiToken` is gated on `role` through a function `$control`, which is the
 * feature worth showing: the form re-derives which fields exist from the
 * current values, so conditional UI needs no branching in the component.
 */
const schema = z.object({
  projectName: z
    .string()
    .meta({ title: "Project name", $control: { width: 100 } }),
  role: z
    .enum(["viewer", "admin"])
    .default("viewer")
    .meta({ title: "Role", $control: { width: 50 } }),
  // A FUNCTION `$control`, which is the feature this page exists to show.
  // ⚠️ It receives `{ form }` and reads `form.currentValues`, and it HIDES the
  // field by returning `false` - there is no `hidden` key. Getting either wrong
  // makes the field silently never appear.
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
    <BlockPage
      title="AutoForm"
      description="A whole form rendered from a zod schema."
    >
      <Specimen
        title="Schema-driven, with a conditional field"
        description="Switch Role to admin and the Api Token field appears."
      >
        <AutoForm
          form={form}
          title="Project settings"
          description="Width and validation come from the schema."
          submitLabel="Save settings"
        />
      </Specimen>
    </BlockPage>
  );
};

export default AutoFormBlock;
