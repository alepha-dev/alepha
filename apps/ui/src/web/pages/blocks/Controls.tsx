import { Control } from "@alepha/ui/components/control/control";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { Mail } from "lucide-react";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * Module scope, not inside the component.
 *
 * `useForm` anchors its schema at mount, so a schema rebuilt on every render
 * re-anchors the form and the fields lose their state. A stable reference is
 * the fix, and module scope is the simplest stable reference there is.
 */
const schema = z.object({
  email: z
    .string()
    .meta({ title: "Email", $control: { autoComplete: "email" } }),
  bio: z.string().meta({ title: "Bio" }).optional(),
  password: z.string().meta({ title: "Password" }),
  age: z.number().meta({ title: "Age" }),
  newsletter: z.boolean().meta({ title: "Subscribe to the newsletter" }),
  role: z.enum(["owner", "admin", "member", "viewer"]).meta({ title: "Role" }),
  birthday: z.string().meta({ format: "date", title: "Birthday" }),
  meetingAt: z.string().meta({ format: "date-time", title: "Meeting at" }),
  alarm: z.string().meta({ format: "time", title: "Alarm" }),
  tags: z.array(z.string()).meta({ title: "Tags" }),
  disabled: z.string().meta({ title: "Disabled" }).optional(),
});

const Controls = () => {
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
      title="Controls"
      description="One component per field, picked from the schema."
    >
      <Specimen title="Text" description="Inferred from z.string().">
        <Control input={form.input.email} icon={Mail} />
        <Control input={form.input.bio} area description="Multi-line." />
        <Control input={form.input.password} password />
      </Specimen>

      <Specimen
        title="Number and boolean"
        description="z.number() renders a numeric input, z.boolean() a switch."
      >
        <Control input={form.input.age} />
        <Control input={form.input.newsletter} />
      </Specimen>

      <Specimen title="Select" description="A z.enum() becomes a select.">
        <Control input={form.input.role} />
      </Specimen>

      <Specimen
        title="Date and time"
        description="Driven by the JSON-Schema format."
      >
        <Control input={form.input.birthday} />
        <Control input={form.input.meetingAt} />
        <Control input={form.input.alarm} />
      </Specimen>

      <Specimen
        title="Array"
        description="z.array() renders a repeatable row with add, remove and reorder."
      >
        <Control input={form.input.tags} />
      </Specimen>

      <Specimen
        title="States"
        description="Disabled and read-only are props, not schema."
      >
        <Control input={form.input.disabled} disabled />
        <Control
          input={form.input.email}
          label="With a description"
          description="Helper text falls back to the schema's own description."
        />
      </Specimen>
    </BlockPage>
  );
};

export default Controls;
