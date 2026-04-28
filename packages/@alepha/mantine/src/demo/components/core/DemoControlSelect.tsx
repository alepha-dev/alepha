import {
  Control,
  Flex,
  type SelectValueLabel,
  Text,
  TypeForm,
  useDialog,
} from "@alepha/mantine";
import { t } from "alepha";
import { useForm } from "alepha/react/form";
import Showcase from "../shared/Showcase.tsx";

// region schemas

const selectSchema = t.object({
  status: t.enum(["active", "inactive", "pending"], {
    title: "Status",
    default: "active",
  }),
  priority: t.enum(["low", "medium", "high", "critical"], {
    title: "Priority",
  }),
});

const multiSelectSchema = t.object({
  roles: t.array(t.enum(["admin", "editor", "viewer", "moderator"]), {
    title: "Roles",
    default: ["editor"],
  }),
});

const autocompleteSchema = t.object({
  city: t.enum(["Paris", "London", "Tokyo", "New York", "Berlin", "Sydney"], {
    title: "City",
    default: "Paris",
  }),
});

const tagsSchema = t.object({
  tags: t.array(t.text(), {
    title: "Tags",
    default: ["typescript", "react"],
  }),
});

const segmentedSchema = t.object({
  theme: t.enum(["light", "dark", "auto"], {
    title: "Theme",
    default: "auto",
  }),
});

const booleanSchema = t.object({
  enabled: t.boolean({
    title: "Enabled",
    default: true,
  }),
});

const numericSchema = t.object({
  rating: t.integer({
    title: "Rating",
    enum: [1, 2, 3, 4, 5] as any,
  }),
});

// endregion

// region async loader

const allCities = Array.from({ length: 200 }, (_, i) => ({
  value: `city-${i}`,
  label: `City ${i} - ${["Alpha", "Beta", "Gamma", "Delta", "Epsilon"][i % 5]}`,
}));

const cityLoader = async (
  search: string,
  resolve?: string[],
): Promise<SelectValueLabel[]> => {
  await new Promise((r) => setTimeout(r, 300));

  if (resolve) {
    return allCities.filter((c) => resolve.includes(c.value));
  }

  if (!search) return allCities;
  return allCities.filter((c) =>
    c.label.toLowerCase().includes(search.toLowerCase()),
  );
};

const shortCities = allCities.slice(0, 20);
const shortCityLoader = async (): Promise<SelectValueLabel[]> => {
  await new Promise((r) => setTimeout(r, 300));
  return shortCities;
};

// endregion

// region shared hook

const useAlertValues = () => {
  const dialog = useDialog();
  return (values: any) => {
    dialog.alert({
      title: "Submitted",
      message: JSON.stringify(values, null, 2),
    });
  };
};

// endregion

// region variant components

const SelectVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: selectSchema, handler }, []);
  return (
    <TypeForm fill form={form} submitButtonProps={{ children: "Submit" }} />
  );
};

const MultiSelectVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: multiSelectSchema, handler }, []);
  return (
    <TypeForm fill form={form} submitButtonProps={{ children: "Submit" }} />
  );
};

const AutocompleteVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: autocompleteSchema, handler }, []);
  return (
    <TypeForm
      fill
      form={form}
      fieldControlProps={{ city: { select: { creatable: true } } }}
      submitButtonProps={{ children: "Submit" }}
    />
  );
};

const TagsVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: tagsSchema, handler }, []);
  return (
    <TypeForm
      fill
      form={form}
      fieldControlProps={{ tags: { select: { creatable: true } } }}
      submitButtonProps={{ children: "Submit" }}
    />
  );
};

const SegmentedVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: segmentedSchema, handler }, []);
  return (
    <TypeForm
      fill
      form={form}
      fieldControlProps={{ theme: { segmented: true } }}
      submitButtonProps={{ children: "Submit" }}
    />
  );
};

const BooleanVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: booleanSchema, handler }, []);
  return (
    <TypeForm fill form={form} submitButtonProps={{ children: "Submit" }} />
  );
};

const NumericVariant = () => {
  const handler = useAlertValues();
  const form = useForm({ schema: numericSchema, handler }, []);
  return (
    <TypeForm
      fill
      form={form}
      fieldControlProps={{
        rating: {
          select: {
            selectProps: {
              data: [
                { value: "1", label: "1 - Poor" },
                { value: "2", label: "2 - Fair" },
                { value: "3", label: "3 - Good" },
                { value: "4", label: "4 - Great" },
                { value: "5", label: "5 - Excellent" },
              ],
            },
          },
        },
      }}
      submitButtonProps={{ children: "Submit" }}
    />
  );
};

const AsyncShortVariant = () => {
  const handler = useAlertValues();
  const asyncSchema = t.object({ city: t.text({ title: "City" }) });
  const form = useForm({ schema: asyncSchema, handler }, []);
  return (
    <Control
      input={form.input.city}
      select={{
        loader: shortCityLoader,
      }}
    />
  );
};

const AsyncLongVariant = () => {
  const handler = useAlertValues();
  const asyncSchema = t.object({ city: t.text({ title: "City" }) });
  const form = useForm({ schema: asyncSchema, handler }, []);
  return (
    <Control
      input={form.input.city}
      select={{
        loader: cityLoader,
        selectProps: { defaultValue: "city-42" },
      }}
    />
  );
};

// endregion

const variants: {
  title: string;
  description: string;
  component: () => React.ReactNode;
}[] = [
  {
    title: "Select",
    description: "Single enum value with dropdown",
    component: SelectVariant,
  },
  {
    title: "Multi Select",
    description: "Array of enum values with multi-select dropdown",
    component: MultiSelectVariant,
  },
  {
    title: "Autocomplete",
    description:
      "Single value with freeform text input — type any value or pick from suggestions",
    component: AutocompleteVariant,
  },
  {
    title: "Tags",
    description: "Array of freeform values — type and press Enter to add tags",
    component: TagsVariant,
  },
  {
    title: "Segmented",
    description: "Enum rendered as segmented toggle buttons",
    component: SegmentedVariant,
  },
  {
    title: "Boolean",
    description:
      "Boolean value — select value is coerced to true/false on submit",
    component: BooleanVariant,
  },
  {
    title: "Numeric",
    description: "Integer enum — select value is coerced to number on submit",
    component: NumericVariant,
  },
  {
    title: "Async (Short)",
    description:
      "Loader returns <= 100 items — client-side filtering, single network call",
    component: AsyncShortVariant,
  },
  {
    title: "Async (Long)",
    description:
      "Loader returns > 100 items — server-side filtering with debounced search",
    component: AsyncLongVariant,
  },
];

const showcaseSchema = t.object({});

const DemoControlSelect = () => {
  return (
    <Showcase title="ControlSelect" schema={showcaseSchema}>
      {() => (
        <Flex direction="column" gap="xl">
          {variants.map((variant) => (
            <Flex
              rounded
              shadowed={"sm"}
              bordered
              key={variant.title}
              direction="column"
            >
              <Flex elevated rounded col borderedBottom p={"sm"}>
                <Text fw={600}>{variant.title}</Text>
                <Text size="sm" c="dimmed">
                  {variant.description}
                </Text>
              </Flex>
              <Flex rounded surface p={"xs"}>
                <variant.component />
              </Flex>
            </Flex>
          ))}
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoControlSelect;
