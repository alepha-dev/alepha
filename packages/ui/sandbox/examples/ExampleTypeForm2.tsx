import { useForm } from "@alepha/react/form";
import { TypeForm } from "@alepha/ui";
import { t } from "alepha";

const ExampleTypeForm2 = () => {
  const form = useForm(
    {
      schema: t.object({
        name: t.text(),
        address: t.object({
          street: t.text(),
          city: t.text(),
        }),
        passengers: t.array(
          t.object({
            name: t.text(),
            age: t.integer(),
          }),
        ),
      }),
      handler: (values) => {
        console.log(values);
      },
    },
    [],
  );

  return <TypeForm fill form={form} />;
};

export default ExampleTypeForm2;
