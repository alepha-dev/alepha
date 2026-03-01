import { Control, type SelectValueLabel, TypeForm } from "@alepha/ui";
import { Card, Flex, Text } from "@mantine/core";
import { t } from "alepha";
import { useForm } from "alepha/react/form";

/**
 * Section wrapper for each demo case.
 */
const Section = (props: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <Card shadow="sm" radius="md" w="100%">
    <Card.Section withBorder py="xs" inheritPadding>
      <Text size="sm" fw={600}>
        {props.title}
      </Text>
      <Text size="xs" c="dimmed">
        {props.description}
      </Text>
    </Card.Section>
    <Card.Section p="md">{props.children}</Card.Section>
  </Card>
);

/**
 * Reusable form demo — renders a TypeForm and shows submitted JSON.
 */
const FormDemo = <T extends ReturnType<typeof t.object>>(props: {
  id: string;
  schema: T;
  fieldControlProps?: Record<string, any>;
  children?: React.ReactNode;
}) => {
  const form = useForm(
    {
      schema: props.schema,
      handler: (values) => {
        alert(JSON.stringify(values, null, 2));
      },
    },
    [],
  );

  return (
    <TypeForm
      form={form}
      columns={1}
      fieldControlProps={props.fieldControlProps}
      submitButtonProps={{ children: "Submit" }}
    />
  );
};

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

const AsyncSelectDemo = (props: {
  title: string;
  description: string;
  loader: (search: string, resolve?: string[]) => Promise<SelectValueLabel[]>;
  defaultValue?: string;
}) => {
  const schema = t.object({
    city: t.text({ title: "City" }),
  });

  const form = useForm(
    {
      schema,
      handler: (values) => {
        alert(JSON.stringify(values, null, 2));
      },
    },
    [],
  );

  return (
    <Section title={props.title} description={props.description}>
      <Control
        input={form.input.city}
        select={{
          loader: props.loader,
          selectProps: { defaultValue: props.defaultValue },
        }}
      />
    </Section>
  );
};

const DemoControlSelect = () => {
  return (
    <Flex direction="column" gap="lg" p="md" maw={600}>
      <Text size="xl" fw={700}>
        ControlSelect
      </Text>
      <Text size="sm" c="dimmed">
        All select-like form controls: Select, MultiSelect, Autocomplete,
        TagsInput, SegmentedControl, and async loading modes.
      </Text>

      <Section title="Select" description="Single enum value with dropdown">
        <FormDemo id="select" schema={selectSchema} />
      </Section>

      <Section
        title="MultiSelect"
        description="Array of enum values with multi-select dropdown"
      >
        <FormDemo id="multi" schema={multiSelectSchema} />
      </Section>

      <Section
        title="Autocomplete (creatable)"
        description="Single value with freeform text input — type any value or pick from suggestions"
      >
        <FormDemo
          id="autocomplete"
          schema={autocompleteSchema}
          fieldControlProps={{
            city: { select: { creatable: true } },
          }}
        />
      </Section>

      <Section
        title="TagsInput (creatable + array)"
        description="Array of freeform values — type and press Enter to add tags"
      >
        <FormDemo
          id="tags"
          schema={tagsSchema}
          fieldControlProps={{
            tags: { select: { creatable: true } },
          }}
        />
      </Section>

      <Section
        title="SegmentedControl"
        description="Enum rendered as segmented toggle buttons"
      >
        <FormDemo
          id="segmented"
          schema={segmentedSchema}
          fieldControlProps={{
            theme: { segmented: true },
          }}
        />
      </Section>

      <Section
        title="Numeric Select"
        description="Integer enum — select value is coerced to number on submit"
      >
        <FormDemo
          id="numeric"
          schema={numericSchema}
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
        />
      </Section>

      <AsyncSelectDemo
        title="Async Select (short mode)"
        description="Loader returns <= 100 items — client-side filtering, single network call"
        loader={shortCityLoader}
      />

      <AsyncSelectDemo
        title="Async Select (long mode)"
        description="Loader returns > 100 items — server-side filtering with debounced search"
        loader={cityLoader}
        defaultValue="city-42"
      />
    </Flex>
  );
};

export default DemoControlSelect;
