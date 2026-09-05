import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { Globe, Mail } from "lucide-react";

import { Group } from "@/web/components/Group.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Everything `Control` renders from a `z.string()`.
 *
 * The knobs are the props that OVERRIDE the schema's choice, applied to every
 * field at once so the difference reads across shapes rather than on one.
 */
const KNOBS = z.object({
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  readOnly: z.boolean().default(false).meta({ title: "readOnly" }),
  icons: z.boolean().default(true).meta({ title: "Icons" }),
  descriptions: z.boolean().default(true).meta({ title: "Help text" }),
});

const schema = z.object({
  name: z.string().meta({ title: "Name" }),
  email: z
    .string()
    .meta({
      format: "email",
      title: "Email",
      $control: { autoComplete: "email" },
    })
    .describe("format: email."),
  password: z.string().meta({ title: "Password" }).describe("Masked."),
  website: z
    .string()
    .meta({ format: "uri", title: "Website" })
    .describe("format: uri.")
    .optional(),
  bio: z
    .string()
    .meta({ title: "Bio" })
    .describe("A textarea, asked for with `area`.")
    .optional(),
  slug: z
    .string()
    .meta({ title: "Slug", $control: { placeholder: "my-project" } })
    .describe("A placeholder, which is not a value.")
    .optional(),
  short: z
    .string()
    .min(2)
    .max(8)
    .meta({ title: "Two to eight" })
    .describe("min/max reach the input as real constraints."),
  code: z
    .string()
    .regex(/^[A-Z]{3}-\d{4}$/)
    .meta({ title: "Pattern" })
    .describe("ABC-1234, enforced by the schema."),
  tags: z
    .array(z.string())
    .meta({ title: "Tags" })
    .describe("An array of strings is a tag list."),
});

const Text = () => {
  const form = useForm({ schema, handler: () => {} }, [schema]);

  return (
    <Showcase
      id="blocks/control/Text"
      title="Text"
      description="Every shape z.string() takes."
      schema={KNOBS}
      initialValues={{
        disabled: false,
        readOnly: false,
        icons: true,
        descriptions: true,
      }}
    >
      {(v) => {
        // `description: undefined` does not clear a schema `describe()` -
        // `Control` falls back to it - so the empty string is what turns the
        // help text off.
        const shared = {
          disabled: v.disabled,
          readOnly: v.readOnly,
          ...(v.descriptions ? {} : { description: "" }),
        };
        return (
          <div className="grid max-w-2xl gap-6">
            <Group title="The plain ones">
              <Control input={form.input.name} {...shared} />
              <Control
                input={form.input.email}
                icon={v.icons ? Mail : undefined}
                {...shared}
              />
              <Control input={form.input.password} password {...shared} />
              <Control
                input={form.input.website}
                icon={v.icons ? Globe : undefined}
                {...shared}
              />
            </Group>

            <Group title="Longer, and decorated">
              <Control input={form.input.bio} area {...shared} />
              <Control input={form.input.slug} {...shared} />
            </Group>

            <Group title="Constrained by the schema">
              <Control input={form.input.short} {...shared} />
              <Control input={form.input.code} {...shared} />
            </Group>

            <Group title="Repeated">
              <Control input={form.input.tags} {...shared} />
            </Group>
          </div>
        );
      }}
    </Showcase>
  );
};

export default Text;
