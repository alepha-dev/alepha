import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const COLORS_RICH = [
  { value: "red", label: "Red", description: "Warm, energetic", tag: "warm" },
  {
    value: "orange",
    label: "Orange",
    description: "Playful, citrus",
    tag: "warm",
  },
  { value: "blue", label: "Blue", description: "Calm, trust", tag: "cool" },
  {
    value: "green",
    label: "Green",
    description: "Growth, balance",
    tag: "cool",
  },
  {
    value: "purple",
    label: "Purple",
    description: "Royalty, mystery",
    tag: "cool",
  },
];

const COUNTRIES_BIG = Array.from({ length: 50 }, (_, i) => ({
  value: `c${i}`,
  label: `Country #${i + 1}`,
}));

const fakeAsyncSearch = async (q: string) => {
  await new Promise((r) => setTimeout(r, 250));
  const all = COUNTRIES_BIG;
  if (!q) return all.slice(0, 10);
  return all.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
};

const schema = z.object({
  // 1. Native enum
  fruit: z
    .enum(["apple", "banana", "cherry"])
    .meta({ title: "Fruit (enum)", $control: { width: 50 } })
    .describe("Schema enum → native <select>."),
  // 2. List of strings via $control.items
  size: z
    .string()
    .meta({
      title: "Size (strings)",
      $control: { items: ["S", "M", "L", "XL"], width: 50 },
    })
    .describe('$control.items: ["S", "M", "L", "XL"]'),
  // 3. Rich items {value, label, description, tag} → forces combobox (>20 disabled, force via combobox flag)
  color: z
    .string()
    .meta({
      title: "Color (rich items)",
      $control: { items: COLORS_RICH, combobox: true, width: 50 },
    })
    .describe("Items with description + tag."),
  // 4. Segmented (short enum, force segmented)
  size2: z
    .enum(["S", "M", "L"])
    .meta({
      title: "Size (segmented)",
      $control: { segmented: true, width: 50 },
    })
    .describe("$control.segmented = true."),
  // 5. Multi select (array of strings) with createNewEntry
  tags: z
    .array(z.string())
    .meta({
      title: "Tags (multi + create)",
      $control: {
        items: ["alepha", "react", "typescript"],
        createNewEntry: true,
        width: 100,
      },
    })
    .describe("Type and pick the 'Create' entry to add a new tag."),
  // 6. Async loader → 50 items, "long" mode
  country: z
    .string()
    .meta({
      title: "Country (async, lazy)",
      $control: {
        items: fakeAsyncSearch as never,
        width: 50,
      },
    })
    .describe("Items fetched async, refreshed as you type.")
    .optional(),
  // 7. Lots of items → auto-combobox
  many: z
    .string()
    .meta({
      title: "Big static list",
      $control: { items: COUNTRIES_BIG, width: 50 },
    })
    .describe(">20 items → switches to Combobox automatically.")
    .optional(),
  // 8. Clearable — the filter-chip shape, on a list big enough to be a combobox
  region: z
    .string()
    .meta({
      title: "Region (clearable)",
      $control: {
        items: COUNTRIES_BIG,
        clearable: true,
        clearLabel: "All regions",
        width: 50,
      },
    })
    .describe("$control.clearable → an explicit 'All regions' row.")
    .optional(),
});

const SelectsForm = () => {
  const toast = useToast();
  const form = useForm({
    schema,
    initialValues: {
      fruit: "apple",
      size: "M",
      color: "blue",
      size2: "M",
      tags: [],
    },
    handler: (values) => toast.success(JSON.stringify(values, null, 2)),
  });

  return (
    <div className="container mx-auto max-w-3xl p-6">
      <AutoForm
        form={form}
        icon="user"
        title="ControlSelect variants"
        description="Every supported configuration of <ControlSelect>."
      />
    </div>
  );
};

export default SelectsForm;
