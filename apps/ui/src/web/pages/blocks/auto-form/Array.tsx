import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Arrays, which come in two shapes that look nothing alike.
 *
 * An array of SCALARS is a tag list: one field, many values, added inline. An
 * array of OBJECTS is a repeated group with add, remove and reorder - a
 * different control entirely (`ControlArray`), chosen from the element schema
 * rather than from a prop.
 *
 * ⚠️ An array of a UNION of objects is still an array of objects. Classifying
 * it as scalars sends it to the tag list, which stringifies each row to
 * "[object Object]".
 */
const KNOBS = z.object({
  layout: z.enum(["stack", "row"]).default("stack").meta({ title: "layout" }),
  card: z.boolean().default(true).meta({ title: "card" }),
  header: z.boolean().default(true).meta({ title: "Header" }),
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
});

const schema = z.object({
  // ⚠️ `createNewEntry`, or these are selects over an EMPTY list: an array of
  // scalars renders as a multi-select, and one with no `items` opens on "No
  // results." and can never be given a value. Seeded `tags` hid it here - two
  // values showed, and there was no way to add a third.
  tags: z
    .array(z.string())
    .meta({ title: "Tags", $control: { createNewEntry: true } })
    .describe("Scalars: one field, many values, invented as you type."),
  ports: z
    .array(z.integer())
    .meta({ title: "Ports", $control: { createNewEntry: true } })
    .describe("Still a tag list, still numeric per entry."),
  environments: z
    .array(z.enum(["dev", "staging", "prod"]))
    .meta({ title: "Environments" })
    .describe("An enum array is a multi-select."),
  members: z
    .array(
      z.object({
        email: z.string().meta({ format: "email", title: "Email" }),
        role: z
          .enum(["owner", "admin", "member"])
          .default("member")
          .meta({ title: "Role" }),
        notify: z.boolean().default(true).meta({ title: "Notify" }),
      }),
    )
    .meta({ title: "Members" })
    .describe("Objects: a repeated group, with add, remove and reorder."),
  redirects: z
    .array(
      z.object({
        from: z.string().meta({ title: "From", $control: { width: 50 } }),
        to: z.string().meta({ title: "To", $control: { width: 50 } }),
      }),
    )
    .meta({ title: "Redirects" })
    .describe("Widths apply inside a row the same as outside one.")
    .optional(),
});

const ArrayPage = () => {
  const toast = useToast();
  const form = useForm(
    {
      schema,
      initialValues: {
        tags: ["alepha", "react"],
        members: [
          { email: "ada@alepha.dev", role: "owner", notify: true },
          { email: "alan@alepha.dev", role: "member", notify: false },
        ],
      },
      handler: (values) => toast.success(JSON.stringify(values, null, 2)),
    },
    [schema],
  );

  return (
    <Showcase
      id="blocks/auto-form/Array"
      title="AutoForm: arrays"
      description="Tag lists, multi-selects and repeated groups."
      schema={KNOBS}
      initialValues={{
        layout: "stack",
        card: true,
        header: true,
        disabled: false,
      }}
    >
      {(v) => (
        <div className="mx-auto max-w-3xl">
          <AutoForm
            key={`${v.layout}-${v.card}`}
            form={form}
            layout={v.layout}
            card={v.card}
            disabled={v.disabled}
            title={v.header ? "Deployment" : undefined}
            description={
              v.header
                ? "Two rows are seeded, so removal and reorder have something to act on."
                : undefined
            }
            submitLabel="Save"
          />
        </div>
      )}
    </Showcase>
  );
};

export default ArrayPage;
