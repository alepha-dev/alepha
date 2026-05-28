import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { t } from "alepha";
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

const schema = t.object({
  // 1. Native enum
  fruit: t.enum(["apple", "banana", "cherry"], {
    title: "Fruit (enum)",
    description: "Schema enum → native <select>.",
    $control: { width: 50 },
  }),
  // 2. List of strings via $control.items
  size: t.string({
    title: "Size (strings)",
    description: '$control.items: ["S", "M", "L", "XL"]',
    $control: { items: ["S", "M", "L", "XL"], width: 50 },
  }),
  // 3. Rich items {value, label, description, tag} → forces combobox (>20 disabled, force via combobox flag)
  color: t.string({
    title: "Color (rich items)",
    description: "Items with description + tag.",
    $control: { items: COLORS_RICH, combobox: true, width: 50 },
  }),
  // 4. Segmented (short enum, force segmented)
  size2: t.enum(["S", "M", "L"], {
    title: "Size (segmented)",
    description: "$control.segmented = true.",
    $control: { segmented: true, width: 50 },
  }),
  // 5. Multi select (array of strings) with createNewEntry
  tags: t.array(t.string(), {
    title: "Tags (multi + create)",
    description: "Type and pick the 'Create' entry to add a new tag.",
    $control: {
      items: ["alepha", "react", "typescript"],
      createNewEntry: true,
      width: 100,
    },
  }),
  // 6. Async loader → 50 items, "long" mode
  country: t.optional(
    t.string({
      title: "Country (async, lazy)",
      description: "Items fetched async, refreshed as you type.",
      $control: {
        items: fakeAsyncSearch as never,
        width: 50,
      },
    }),
  ),
  // 7. Lots of items → auto-combobox
  many: t.optional(
    t.string({
      title: "Big static list",
      description: ">20 items → switches to Combobox automatically.",
      $control: { items: COUNTRIES_BIG, width: 50 },
    }),
  ),
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
