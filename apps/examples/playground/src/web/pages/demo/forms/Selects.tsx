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

/**
 * Short list exercising every per-option feature the old native-`Select`
 * path dropped below the threshold: description, tag, icon, disabled.
 */
const ROLES_SHORT = [
  {
    value: "user",
    label: "User",
    description: "Everyone gets this",
    tag: "base",
    disabled: true,
  },
  { value: "editor", label: "Editor", description: "Can write content" },
  { value: "admin", label: "Admin", description: "Full access", tag: "danger" },
];

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
    .describe("Schema enum → select, with no $control at all."),
  // 2. List of strings via $control.items
  size: z
    .string()
    .meta({
      title: "Size (strings)",
      $control: { items: ["S", "M", "L", "XL"], width: 50 },
    })
    .describe('$control.items: ["S", "M", "L", "XL"]'),
  // 3. Rich items {value, label, description, tag} — no flag needed anymore
  color: z
    .string()
    .meta({
      title: "Color (rich items)",
      $control: { items: COLORS_RICH, width: 50 },
    })
    .describe("Items with description + tag, on a 5-item list."),
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
  // 9. Short list, every per-option feature — no search box, same control
  role: z
    .string()
    .meta({
      title: "Role (short, rich, no search)",
      $control: { items: ROLES_SHORT, width: 50 },
    })
    .describe(
      "3 items → no search field, but description/tag/disabled still render.",
    )
    .optional(),
  // 9b. Same list, search forced on — checks disabled rows behave the same
  // with and without the input in the popup.
  role2: z
    .string()
    .meta({
      title: "Role (rich + search)",
      $control: { items: ROLES_SHORT, searchable: true, width: 50 },
    })
    .describe("Same options, search field on.")
    .optional(),
  // 10. Force the search field ON for a short list
  fruit2: z
    .enum(["apple", "banana", "cherry"])
    .meta({
      title: "Fruit (searchable: true)",
      $control: { searchable: true, width: 50 },
    })
    .describe("$control.searchable = true → search on a 3-item list.")
    .optional(),
  // 11. Force the search field OFF for a long list
  many2: z
    .string()
    .meta({
      title: "Big list (searchable: false)",
      $control: { items: COUNTRIES_BIG, searchable: false, width: 50 },
    })
    .describe("$control.searchable = false → 50 items, scroll only.")
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
