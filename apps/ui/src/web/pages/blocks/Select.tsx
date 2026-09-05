import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { Group } from "@/web/components/Group.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * `ControlSelect` has the widest option surface of any control, and most of it
 * is invisible until the data forces it: the same component is a segmented
 * group, a plain select, a searchable popup and an async combobox depending on
 * its item count and its switches.
 *
 * The knobs drive the first control. Everything below is fixed, because those
 * behaviours are decided by the schema rather than by a prop.
 */
const KNOBS = z.object({
  itemCount: z
    .enum(["3", "8", "50"])
    .default("8")
    .meta({ title: "How many items" }),
  segmented: z.boolean().default(false).meta({ title: "segmented" }),
  searchable: z.boolean().default(false).meta({ title: "searchable" }),
  clearable: z.boolean().default(false).meta({ title: "clearable" }),
  multiple: z.boolean().default(false).meta({ title: "multiple" }),
  rich: z.boolean().default(false).meta({ title: "descriptions + tags" }),
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
});

const PLAIN = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
];

const RICH = [
  { value: "owner", label: "Owner", description: "Full access", tag: "admin" },
  {
    value: "admin",
    label: "Admin",
    description: "Manages members",
    tag: "admin",
  },
  { value: "member", label: "Member", description: "The default", tag: "base" },
  { value: "viewer", label: "Viewer", description: "Read only", tag: "base" },
  { value: "billing", label: "Billing", description: "Invoices only" },
  { value: "auditor", label: "Auditor", description: "Reads the audit log" },
  { value: "support", label: "Support", description: "Impersonates users" },
  { value: "bot", label: "Bot", description: "Machine account" },
];

const BIG = Array.from({ length: 50 }, (_, i) => ({
  value: `c${i}`,
  label: `Country #${i + 1}`,
}));

const itemsFor = (count: string, rich: boolean) => {
  if (count === "50") return BIG;
  const n = count === "3" ? 3 : 8;
  return rich ? RICH.slice(0, n) : PLAIN.slice(0, n);
};

const fakeSearch = async (q: string) => {
  await new Promise((r) => setTimeout(r, 250));
  if (!q) return BIG.slice(0, 10);
  return BIG.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
};

const liveSchema = z.object({
  one: z.string().optional(),
  many: z.array(z.string()),
});

const staticSchema = z.object({
  fruit: z
    .enum(["apple", "banana", "cherry"])
    .meta({ title: "Fruit (a bare enum)" })
    .describe("No $control at all: the schema is the configuration."),
  size: z
    .string()
    .meta({
      title: "Size (strings)",
      $control: { items: ["S", "M", "L", "XL"] },
    })
    .describe("items may be plain strings when value and label agree."),
  country: z
    .string()
    .meta({ title: "Country (50 items)", $control: { items: BIG } })
    .describe("Past the threshold it becomes a combobox on its own.")
    .optional(),
  segmented: z
    .enum(["S", "M", "L"])
    .meta({ title: "Segmented", $control: { segmented: true } })
    .optional(),
  role: z
    .string()
    .meta({
      title: "Role (rich, short)",
      $control: { items: RICH.slice(0, 4) },
    })
    .describe("Descriptions and tags, no search field.")
    .optional(),
  roleSearch: z
    .string()
    .meta({
      title: "Role (search forced on)",
      $control: { items: RICH.slice(0, 4), searchable: true },
    })
    .optional(),
  longNoSearch: z
    .string()
    .meta({
      title: "50 items (search forced off)",
      $control: { items: BIG, searchable: false },
    })
    .optional(),
  region: z
    .string()
    .meta({
      title: "Clearable",
      $control: { items: BIG, clearable: true, clearLabel: "All regions" },
    })
    .describe("The clear label is the placeholder.")
    .optional(),
  tags: z
    .array(z.string())
    .meta({
      title: "Tags (multi + create)",
      $control: {
        items: ["alepha", "react", "typescript", "zod"],
        createNewEntry: true,
      },
    })
    .describe("Type something absent and pick the Create row."),
  asyncCountry: z
    .string()
    .meta({ title: "Async", $control: { items: fakeSearch as never } })
    .describe("Fetched as you type, debounced.")
    .optional(),
});

const SelectPage = () => {
  const live = useForm({ schema: liveSchema, handler: () => {} }, [liveSchema]);
  const statics = useForm({ schema: staticSchema, handler: () => {} }, [
    staticSchema,
  ]);

  return (
    <Showcase
      title="Select"
      description="Every shape one control takes."
      schema={KNOBS}
      initialValues={{
        itemCount: "8",
        segmented: false,
        searchable: false,
        clearable: false,
        multiple: false,
        rich: false,
        disabled: false,
      }}
    >
      {(v) => (
        <div className="max-w-2xl space-y-8">
          <Group title="Driven by the knobs">
            <Control
              input={v.multiple ? live.input.many : live.input.one}
              label={v.multiple ? "Pick several" : "Pick one"}
              items={itemsFor(v.itemCount, v.rich) as never}
              segmented={v.segmented}
              searchable={v.searchable}
              clearable={v.clearable}
              clearLabel="Any"
              disabled={v.disabled}
            />
          </Group>

          <Group title="Chosen by the data">
            <Control input={statics.input.fruit} />
            <Control input={statics.input.size} />
            <Control input={statics.input.country} />
            <Control input={statics.input.segmented} />
          </Group>

          <Group title="Rich items">
            <Control input={statics.input.role} />
            <Control input={statics.input.roleSearch} />
          </Group>

          <Group title="Overriding the automatic choice">
            <Control input={statics.input.longNoSearch} />
            <Control input={statics.input.region} />
          </Group>

          <Group title="Multiple, async, and inventing a value">
            <Control input={statics.input.tags} />
            <Control input={statics.input.asyncCountry} />
          </Group>
        </div>
      )}
    </Showcase>
  );
};

export default SelectPage;
