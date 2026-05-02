import { AutoForm } from "@alepha/ui/components/auto-form";
import { t } from "alepha";
import { useForm } from "alepha/react/form";
import { toast } from "sonner";

const profileSchema = t.object({
  username: t.string({
    minLength: 2,
    maxLength: 32,
    description: "Display name shown across the app.",
    $control: { icon: "user" },
  }),
  email: t.string({
    format: "email",
    description: "We'll never share your address.",
  }),
  password: t.optional(
    t.string({
      description: "At least 8 characters.",
    }),
  ),
  bio: t.optional(
    t.string({
      maxLength: 600,
      description: "A short description (auto-textarea kicks in over 256).",
    }),
  ),
  age: t.optional(t.integer({ minimum: 0, maximum: 130 })),
  newsletter: t.boolean({ default: false }),
  role: t.enum(["admin", "editor", "viewer"], { default: "viewer" }),
  // Function $control — only visible when role === admin
  apiToken: t.optional(
    t.string({
      description:
        "Only visible when role is admin (driven by $control function).",
      $control: ({ form }) => {
        const role = (form.currentValues as { role?: string }).role;
        if (role !== "admin") return false;
        return { icon: "key", password: true };
      },
    }),
  ),
  // Object subgroup — with description
  address: t.optional(
    t.object(
      {
        street: t.string({ description: "Street and number." }),
        city: t.string(),
        zip: t.string({
          pattern: "^[0-9A-Za-z -]{2,12}$",
          description: "ZIP / postal code.",
        }),
      },
      {
        title: "Address",
        description: "Optional postal address. Use the + button to add one.",
      },
    ),
  ),
  // Array of objects with description, custom delete confirmation, custom tab name.
  // The array auto-switches to tabs mode once items > 4 OR contain nested fields.
  contacts: t.array(
    t.object({
      label: t.string(),
      value: t.string({ format: "email" }),
    }),
    {
      title: "Contacts",
      description: "Add up to 6 ways to reach you.",
      maxItems: 6,
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
    },
  ),
  // Tags = array of primitive strings with description
  tags: t.optional(
    t.array(t.string(), {
      title: "Tags",
      description: "Free-form tag list.",
    }),
  ),
});

const AutoFormDemo = () => {
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
