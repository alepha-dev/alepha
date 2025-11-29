import { useInject } from "@alepha/react";
import { type FormModel, useForm, useFormState } from "@alepha/react/form";
import { TypeForm } from "@alepha/ui";
import type { ComboboxLikeRenderOptionInput } from "@mantine/core";
import { Flex, Group, Paper } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { type TObject, TypeProvider, t } from "alepha";
import { HttpClient } from "alepha/server";

TypeProvider.setLocale("fr_FR");

const renderOption = (
  item: ComboboxLikeRenderOptionInput<{
    label: string;
    value: string;
    icon?: string;
  }>,
) => (
  <Group flex="1" gap="xs">
    <img
      alt={item.option.value}
      width={20}
      height={16}
      src={item.option.icon}
    />
    {item.option.label}
    {item.checked && <IconCheck style={{ marginInlineStart: "auto" }} />}
  </Group>
);

const Playground = () => {
  const http = useInject(HttpClient);
  const form = useForm({
    schema: t.object({
      name: t.text({
        minLength: 10,
      }),
      status: t.text({
        $control: {
          select: {
            select: {
              searchable: true,
              renderOption,
            },
            loader: () =>
              http
                .fetch(
                  "https://restcountries.com/v3.1/all?fields=name,flags,cca2",
                  {
                    schema: {
                      response: t.array(
                        t.object({
                          name: t.object({
                            common: t.text(),
                          }),
                          flags: t.object({
                            svg: t.text(),
                          }),
                          cca2: t.text(),
                        }),
                      ),
                    },
                  },
                )
                .then(({ data }) =>
                  data
                    .map((it) => ({
                      value: it.cca2,
                      label: it.name.common,
                      icon: it.flags.svg,
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
                ),
          },
        },
      }),
    }),
    handler: (values) => {
      console.log(values);
    },
  });

  return (
    <Flex p={"xl"}>
      <Paper withBorder w={800} mx={"auto"} p={"lg"}>
        <TypeForm form={form} />
        <TypeFormViewer form={form} />
      </Paper>
    </Flex>
  );
};

export default Playground;

const TypeFormViewer = ({ form }: { form: FormModel<TObject> }) => {
  const formState = useFormState(form, ["values"]);
  return (
    <pre style={{ marginTop: 20, fontSize: 12 }}>
      {JSON.stringify(formState.values ?? {}, null, 2)}
    </pre>
  );
};
