import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { Mail } from "lucide-react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * `Control` picks its input from the schema. The knobs here are the props that
 * OVERRIDE that choice, applied to every field at once so the difference is
 * visible across types rather than on one example.
 */
const KNOBS = z.object({
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  readOnly: z.boolean().default(false).meta({ title: "readOnly" }),
  showDescriptions: z
    .boolean()
    .default(true)
    .meta({ title: "Show descriptions" }),
  icons: z.boolean().default(true).meta({ title: "Leading icons" }),
});

const schema = z.object({
  email: z
    .string()
    .meta({ title: "Email", $control: { autoComplete: "email" } })
    .describe("Inferred from z.string()."),
  bio: z.string().meta({ title: "Bio" }).describe("Long text.").optional(),
  password: z.string().meta({ title: "Password" }).describe("Masked."),
  age: z.number().meta({ title: "Age" }).describe("Numeric."),
  amount: z
    .number()
    .meta({ title: "Amount" })
    .describe("Numeric with a step.")
    .optional(),
  newsletter: z.boolean().meta({ title: "Newsletter" }).describe("A switch."),
  role: z
    .enum(["owner", "admin", "member", "viewer"])
    .meta({ title: "Role" })
    .describe("An enum becomes a select."),
  birthday: z
    .string()
    .meta({ format: "date", title: "Birthday" })
    .describe("format: date."),
  meetingAt: z
    .string()
    .meta({ format: "date-time", title: "Meeting at" })
    .describe("format: date-time."),
  alarm: z
    .string()
    .meta({ format: "time", title: "Alarm" })
    .describe("format: time."),
  website: z
    .string()
    .meta({ format: "uri", title: "Website" })
    .describe("format: uri.")
    .optional(),
  tags: z
    .array(z.string())
    .meta({ title: "Tags" })
    .describe("An array is repeatable: add, remove, reorder."),
  address: z
    .object({
      street: z.string().meta({ title: "Street" }),
      city: z.string().meta({ title: "City" }),
    })
    .meta({ title: "Address" })
    .describe("A nested object folds into its own group.")
    .optional(),
});

const Controls = () => {
  const form = useForm({ schema, handler: () => {} }, [schema]);

  return (
    <Showcase
      title="Control"
      description="One component per field, picked from the schema."
      schema={KNOBS}
      initialValues={{
        disabled: false,
        readOnly: false,
        showDescriptions: true,
        icons: true,
      }}
    >
      {(v) => {
        const shared = { disabled: v.disabled, readOnly: v.readOnly };
        const desc = (text: string) =>
          v.showDescriptions ? { description: text } : {};
        return (
          <div className="grid max-w-3xl gap-4">
            <Control
              input={form.input.email}
              icon={v.icons ? Mail : undefined}
              {...shared}
              {...desc("Text, inferred from z.string().")}
            />
            <Control input={form.input.bio} area {...shared} />
            <Control input={form.input.password} password {...shared} />
            <Control input={form.input.age} {...shared} />
            <Control input={form.input.amount} number {...shared} />
            <Control input={form.input.newsletter} {...shared} />
            <Control input={form.input.role} {...shared} />
            <Control input={form.input.birthday} {...shared} />
            <Control input={form.input.meetingAt} {...shared} />
            <Control input={form.input.alarm} {...shared} />
            <Control input={form.input.website} {...shared} />
            <Control input={form.input.tags} {...shared} />
            <Control input={form.input.address} {...shared} />
          </div>
        );
      }}
    </Showcase>
  );
};

export default Controls;
