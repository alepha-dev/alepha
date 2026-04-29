import { TypeForm, useDialog } from "@alepha/mantine";
import { t } from "alepha";
import { useForm } from "alepha/react/form";
import Showcase from "../shared/Showcase.tsx";

const formSchema = t.object({
  username: t.text({ title: "Username", default: "" }),
  email: t.email({ title: "Email", default: "" }),
  age: t.integer({ title: "Age", minimum: 0, maximum: 120 }),
  role: t.enum(["admin", "user", "guest"], { title: "Role", default: "user" }),
  subscribe: t.boolean({ title: "Subscribe", default: false }),
});

const showcaseSchema = t.object({
  columns: t.integer({
    title: "Columns",
    default: 1,
    minimum: 1,
    maximum: 4,
    $control: { slider: true },
  }),
  fill: t.boolean({
    title: "Fill Width",
    default: false,
    $control: { switch: true },
  }),
  skipSubmitButton: t.boolean({
    title: "Hide Submit",
    default: false,
    $control: { switch: true },
  }),
});

const DemoTypeForm = () => {
  const dialog = useDialog();

  const form = useForm(
    {
      schema: formSchema,
      handler: (values) => {
        dialog.alert({
          title: "Submitted",
          message: JSON.stringify(values, null, 2),
        });
      },
    },
    [],
  );

  return (
    <Showcase
      title="TypeForm"
      schema={showcaseSchema}
      initialValues={{
        columns: 1,
        fill: false,
        skipSubmitButton: false,
      }}
      columns={1}
    >
      {(props) => (
        <TypeForm
          form={form}
          columns={props.columns}
          fill={props.fill}
          skipSubmitButton={props.skipSubmitButton}
          submitButtonProps={{ children: "Submit" }}
        />
      )}
    </Showcase>
  );
};

export default DemoTypeForm;
