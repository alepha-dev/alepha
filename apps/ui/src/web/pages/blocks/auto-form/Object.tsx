import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Nested objects, which is where a form generator earns its keep: each one
 * folds into a group of its own, several levels deep, and an OPTIONAL object
 * starts uninitialised rather than pretending to be an empty one.
 *
 * That distinction is the point of the `contact` field below. Until it is
 * initialised the payload has no `contact` key at all - not `{}` - which is
 * what a server validating "absent or complete" needs to see.
 */
const KNOBS = z.object({
  layout: z.enum(["stack", "row"]).default("stack").meta({ title: "layout" }),
  card: z.boolean().default(true).meta({ title: "card" }),
  autoGroup: z.boolean().default(false).meta({ title: "autoGroup" }),
  header: z.boolean().default(true).meta({ title: "Header" }),
});

const schema = z.object({
  name: z
    .string()
    .meta({ title: "Name" })
    .describe("A plain field, for scale."),
  contact: z
    .object({
      email: z.string().meta({ format: "email", title: "Email" }),
      phone: z.string().meta({ title: "Phone" }).optional(),
    })
    .meta({ title: "Contact" })
    .describe("Optional: absent until initialised, then complete.")
    .optional(),
  billing: z
    .object({
      company: z.string().meta({ title: "Company" }),
      vat: z.string().meta({ title: "VAT number" }).optional(),
      address: z
        .object({
          line1: z.string().meta({ title: "Line 1" }),
          city: z.string().meta({ title: "City" }),
          postalCode: z.string().meta({ title: "Postal code" }),
          country: z
            .enum(["FR", "BE", "GB", "US"])
            .meta({ title: "Country" })
            .default("FR"),
        })
        .meta({ title: "Address" })
        .describe("Two levels down, and still a group."),
    })
    .meta({ title: "Billing" }),
  preferences: z
    .object({
      theme: z.enum(["system", "light", "dark"]).default("system").meta({
        title: "Theme",
      }),
      newsletter: z.boolean().default(false).meta({ title: "Newsletter" }),
    })
    .meta({ title: "Preferences" })
    .describe("A required object is seeded with its own defaults."),
});

const ObjectPage = () => {
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
      id="blocks/auto-form/Object"
      title="AutoForm: objects"
      description="Nested groups, and optional versus required."
      schema={KNOBS}
      initialValues={{
        layout: "stack",
        card: true,
        autoGroup: false,
        header: true,
      }}
    >
      {(v) => (
        <div className="mx-auto max-w-3xl">
          <AutoForm
            key={`${v.layout}-${v.card}-${v.autoGroup}`}
            form={form}
            layout={v.layout}
            card={v.card}
            autoGroup={v.autoGroup}
            title={v.header ? "Organisation" : undefined}
            description={
              v.header
                ? "Contact is absent from the payload until you open it."
                : undefined
            }
            submitLabel="Save"
          />
        </div>
      )}
    </Showcase>
  );
};

export default ObjectPage;
