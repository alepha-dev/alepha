import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const profileSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .meta({ $control: { icon: "user" } })
    .describe("Display name shown across the app."),
  email: z
    .string()
    .meta({ format: "email" })
    .describe("We'll never share your address."),
  password: z.string().describe("At least 8 characters.").optional(),
  bio: z
    .string()
    .max(600)
    .describe("A short description (auto-textarea kicks in over 256).")
    .optional(),
  age: z.integer().min(0).max(130).optional(),
  newsletter: z.boolean().default(false),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
  // Function $control — only visible when role === admin
  apiToken: z
    .string()
    .meta({
      $control: ({ form }) => {
        const role = (form.currentValues as { role?: string }).role;
        if (role !== "admin") return false;
        return { icon: "key", password: true };
      },
    })
    .describe("Only visible when role is admin (driven by $control function).")
    .optional(),
  // Object subgroup — with description
  address: z
    .object({
      street: z.string().describe("Street and number."),
      city: z.string(),
      zip: z
        .string()
        .regex(/^[0-9A-Za-z -]{2,12}$/)
        .describe("ZIP / postal code."),
    })
    .meta({ title: "Address" })
    .describe("Optional postal address. Use the + button to add one.")
    .optional(),
  // Array of objects with description, custom delete confirmation, custom tab name.
  // The array auto-switches to tabs mode once items > 4 OR contain nested fields.
  contacts: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().meta({ format: "email" }),
      }),
    )
    .max(6)
    .meta({
      title: "Contacts",
      $control: {
        arrayProps: {
          confirmDelete: {
            title: "Remove contact",
            message: "This contact will be deleted from the list.",
          },
          renderTabName: (i, value) =>
            (value as { label?: string })?.label || `Contact #${i + 1}`,
        },
      },
    })
    .describe("Add up to 6 ways to reach you."),
  // Tags = array of primitive strings with description
  tags: z
    .array(z.string())
    .meta({ title: "Tags" })
    .describe("Free-form tag list.")
    .optional(),
});

const AutoFormDemo = () => {
  const toast = useToast();
  const form = useForm({
    schema: profileSchema,
    initialValues: {
      username: "alice",
      email: "alice@example.com",
      newsletter: false,
      role: "viewer",
      contacts: [],
    },
    handler: (values) => {
      toast.success(`Submitted: ${JSON.stringify(values, null, 2)}`);
    },
  });

  return (
    <div className="container mx-auto max-w-3xl p-6">
      <AutoForm
        form={form}
        icon="cog"
        title="Account profile"
        description="All fields are schema-driven via $control. Try changing role to admin, leaving a required field empty and submitting, or adding 5+ contacts to see the tabs UI."
        autoGroup
        disabledIfPristine
        actions={[
          {
            label: "Print state",
            icon: "list",
            variant: "ghost",
            onClick: () => {
              toast.info(JSON.stringify(form.currentValues, null, 2));
            },
          },
        ]}
        onCancel={() => toast.info("Cancelled (no-op)")}
      />
    </div>
  );
};

export default AutoFormDemo;
