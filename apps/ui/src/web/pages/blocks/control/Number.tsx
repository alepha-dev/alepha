import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { Group } from "@/web/components/Group.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Numbers, and the two neighbours that are numeric to a person but not to the
 * schema: a boolean switch and a slider over a bounded range.
 *
 * `z.number()` and `z.integer()` are different inputs, not the same one validated
 * differently: the integer field refuses a decimal at the keyboard.
 */
const KNOBS = z.object({
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  readOnly: z.boolean().default(false).meta({ title: "readOnly" }),
  descriptions: z.boolean().default(true).meta({ title: "Help text" }),
});

const schema = z.object({
  age: z
    .integer()
    .meta({ title: "Age" })
    .describe("z.integer(), whole numbers only."),
  price: z
    .number()
    .meta({ title: "Price" })
    .describe("z.number(), decimals allowed."),
  quantity: z
    .integer()
    .min(1)
    .max(99)
    .meta({ title: "Quantity" })
    .describe("min/max become the input's own bounds."),
  rating: z
    .integer()
    .min(0)
    .max(5)
    .meta({ title: "Rating", $control: { slider: true } })
    .describe("The same bounded integer, as a slider.")
    .optional(),
  discount: z
    .number()
    .min(0)
    .max(1)
    .meta({ title: "Discount" })
    .describe("A decimal inside a 0-1 range.")
    .optional(),
  newsletter: z
    .boolean()
    .meta({ title: "Newsletter" })
    .describe("A boolean is a switch, not a checkbox."),
  seats: z
    .array(z.integer())
    .meta({ title: "Seats" })
    .describe("An array of numbers stays numeric per entry."),
});

const NumberPage = () => {
  const form = useForm({ schema, handler: () => {} }, [schema]);

  return (
    <Showcase
      id="blocks/control/Number"
      title="Number"
      description="Integers, decimals, bounds and the switch."
      schema={KNOBS}
      initialValues={{ disabled: false, readOnly: false, descriptions: true }}
    >
      {(v) => {
        const shared = {
          disabled: v.disabled,
          readOnly: v.readOnly,
          ...(v.descriptions ? {} : { description: "" }),
        };
        return (
          <div className="grid max-w-2xl gap-6">
            <Group title="Whole and fractional">
              <Control input={form.input.age} {...shared} />
              <Control input={form.input.price} number {...shared} />
            </Group>

            <Group title="Bounded">
              <Control input={form.input.quantity} {...shared} />
              <Control input={form.input.rating} {...shared} />
              <Control input={form.input.discount} number {...shared} />
            </Group>

            <Group title="Numeric in spirit">
              <Control input={form.input.newsletter} {...shared} />
              <Control input={form.input.seats} {...shared} />
            </Group>
          </div>
        );
      }}
    </Showcase>
  );
};

export default NumberPage;
