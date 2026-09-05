import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * `ControlSelect` has the widest option surface of any control, and most of it
 * is invisible until the data forces it: the same component is a segmented
 * group, a plain select, a searchable popup and an async combobox depending on
 * how many items it has and what you asked for. So this page is one live
 * Showcase for the switches, then specimens for the behaviours a switch cannot
 * show.
 */

const KNOBS = z.object({
  itemCount: z
    .enum(["3", "8", "50"])
    .default("8")
    .meta({ title: "How many items" }),
  segmented: z.boolean().default(false).meta({ title: "segmented" }),
  searchable: z.boolean().default(false).meta({ title: "searchable" }),
  clearable: z.boolean().default(false).meta({ title: "clearable" }),
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  rich: z.boolean().default(false).meta({ title: "descriptions + tags" }),
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

const SelectPage = () => {
  // `handler` is required even where nothing is submitted: these forms exist
  // only to own field state for the specimens, and there is no save to perform.
  const live = useForm({ schema: liveSchema, handler: () => {} }, [liveSchema]);
  const statics = useForm({ schema: staticSchema, handler: () => {} }, [
    staticSchema,
  ]);

  return (
    <BlockPage
      title="Select"
      source="@alepha/ui/components/control-select/control-select"
      description="One component behind every kind of choice: a segmented group, a select, a searchable popup, an async combobox. Which one you get is decided by the item count and by the switches below."
    >
      <Showcase
        title="Every switch, live"
        description="Turn one and the control changes shape. Above roughly 20 items it becomes a combobox on its own, which is why the item count is a knob rather than a fixed list."
        schema={KNOBS}
        initialValues={{
          itemCount: "8",
          segmented: false,
          searchable: false,
          clearable: false,
          disabled: false,
          rich: false,
        }}
      >
        {(v) => (
          <div className="w-full max-w-xs">
            <Control
              input={live.input.pick}
              label="Pick one"
              items={itemsFor(v.itemCount, v.rich) as any}
              segmented={v.segmented}
              searchable={v.searchable}
              clearable={v.clearable}
              clearLabel="Any"
              disabled={v.disabled}
            />
          </div>
        )}
      </Showcase>

      <Specimen
        title="Chosen for you, by the data"
        description="No switches on any of these. The schema alone decides: an enum becomes a select, a short list drops the search box, a long one gains it."
      >
        <Control input={statics.input.fruit} />
        <Control input={statics.input.size} />
        <Control input={statics.input.many} />
      </Specimen>

      <Specimen
        title="Rich items"
        description="An item carries a value, a label, and optionally a description and a tag. The same shape renders with or without the search field."
      >
        <Control input={statics.input.role} />
        <Control input={statics.input.roleSearchable} />
      </Specimen>

      <Specimen
        title="Multiple, and inventing a value"
        description="An array schema becomes a multi-select. `createNewEntry` adds a 'Create' row so a reader can add a value the list never had."
      >
        <Control input={statics.input.tags} />
      </Specimen>

      <Specimen
        title="Async"
        description="`items` as a function is called with the query and may return a promise, so a large or remote list is fetched as the reader types rather than shipped up front."
      >
        <Control input={statics.input.country} />
      </Specimen>

      <Specimen
        title="Clearable"
        description="The filter-chip shape: the clear label IS the placeholder, and an x returns to it. There is no 'none' row in the list, because an empty choice is not a choice."
      >
        <Control input={statics.input.region} />
      </Specimen>

      <Specimen
        title="Overriding the automatic choice"
        description="`searchable` forces the search field on for a short list and off for a long one, which is the escape hatch when the item count is a bad proxy for how hard the list is to scan."
      >
        <Control input={statics.input.shortSearchable} />
        <Control input={statics.input.longUnsearchable} />
      </Specimen>
    </BlockPage>
  );
};

const liveSchema = z.object({
  pick: z.string().optional(),
});

const fakeSearch = async (q: string) => {
  await new Promise((r) => setTimeout(r, 250));
  if (!q) return BIG.slice(0, 10);
  return BIG.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
};

const staticSchema = z.object({
  fruit: z
    .enum(["apple", "banana", "cherry"])
    .meta({ title: "Fruit (a bare enum)" })
    .describe("No $control at all: the schema is the whole configuration."),
  size: z
    .string()
    .meta({
      title: "Size (strings)",
      $control: { items: ["S", "M", "L", "XL"] },
    })
    .describe("`items` may be plain strings when value and label agree."),
  many: z
    .string()
    .meta({ title: "Country (50 items)", $control: { items: BIG } })
    .describe("Past the threshold it becomes a combobox on its own.")
    .optional(),
  role: z
    .string()
    .meta({
      title: "Role (rich, short)",
      $control: { items: RICH.slice(0, 4) },
    })
    .describe("Four items: descriptions and tags, no search field.")
    .optional(),
  roleSearchable: z
    .string()
    .meta({
      title: "Role (rich, searchable)",
      $control: { items: RICH.slice(0, 4), searchable: true },
    })
    .describe("The same four, with the search field forced on.")
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
  country: z
    .string()
    .meta({
      title: "Country (async)",
      $control: { items: fakeSearch as never },
    })
    .describe("Fetched as you type, debounced.")
    .optional(),
  region: z
    .string()
    .meta({
      title: "Region (clearable)",
      $control: { items: BIG, clearable: true, clearLabel: "All regions" },
    })
    .describe("Clearing returns to 'All regions'.")
    .optional(),
  shortSearchable: z
    .enum(["apple", "banana", "cherry"])
    .meta({ title: "Short, search forced ON", $control: { searchable: true } })
    .optional(),
  longUnsearchable: z
    .string()
    .meta({
      title: "Long, search forced OFF",
      $control: { items: BIG, searchable: false },
    })
    .describe("Fifty items, scroll only.")
    .optional(),
});

export default SelectPage;
