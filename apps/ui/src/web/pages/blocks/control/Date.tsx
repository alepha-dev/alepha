import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { Group } from "@/web/components/Group.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Dates are chosen by `format`, not by type: every field below is a
 * `z.string()`, and `date` / `date-time` / `time` are what make it a calendar,
 * a calendar with a clock, and a clock.
 *
 * The selectable range is `startMonth` / `endMonth` - two `Date`s, not two
 * years - because the picker's unit is the month it is showing. `birthdate` is
 * the shorthand for the one range everybody needs: the last 120 years, with a
 * year dropdown.
 *
 * ⚠️ There is no repeated-picker field here, and that is not an omission.
 * `Control` routes an array by its ELEMENT: an array of objects becomes
 * `ControlArray`, and an array of anything else becomes a multi-select. An
 * array of date-formatted strings is therefore a select, not a row of
 * calendars - and with no `items` it is a select over an empty list, which
 * opens on "No results." and can never be given a value. It was on this page
 * claiming to "repeat the picker"; it did nothing at all.
 */
const KNOBS = z.object({
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  dropdowns: z.boolean().default(true).meta({ title: "Dropdowns" }),
  bounded: z.boolean().default(false).meta({ title: "Bound range" }),
  birthdate: z.boolean().default(false).meta({ title: "birthdate" }),
});

const schema = z.object({
  birthday: z
    .string()
    .meta({ format: "date", title: "Birthday" })
    .describe("format: date."),
  meetingAt: z
    .string()
    .meta({ format: "date-time", title: "Meeting at" })
    .describe("format: date-time, a calendar and a clock."),
  alarm: z
    .string()
    .meta({ format: "time", title: "Alarm" })
    .describe("format: time, no calendar at all.")
    .optional(),
  startsOn: z
    .string()
    .meta({ format: "date", title: "Starts on" })
    .describe("A second date, for comparing two in a row.")
    .optional(),
});

const DatePage = () => {
  const form = useForm({ schema, handler: () => {} }, [schema]);

  return (
    <Showcase
      id="blocks/control/Date"
      title="Date"
      description="Calendar, clock, and both together."
      schema={KNOBS}
      initialValues={{
        disabled: false,
        dropdowns: true,
        bounded: false,
        birthdate: false,
      }}
    >
      {(v) => {
        const shared = {
          disabled: v.disabled,
          captionLayout: (v.dropdowns ? "dropdown" : "label") as
            | "dropdown"
            | "label",
          birthdate: v.birthdate,
          // A literal range rather than one derived from today: a fixture that
          // moves with the clock is a fixture that reads differently tomorrow.
          ...(v.bounded
            ? {
                startMonth: new Date(2026, 0, 1),
                endMonth: new Date(2026, 11, 1),
              }
            : {}),
        };
        return (
          <div className="grid max-w-2xl gap-6">
            <Group title="One value each">
              <Control input={form.input.birthday} {...shared} />
              <Control input={form.input.meetingAt} {...shared} />
              <Control input={form.input.alarm} {...shared} />
            </Group>

            <Group title="Side by side">
              <Control input={form.input.startsOn} {...shared} />
            </Group>
          </div>
        );
      }}
    </Showcase>
  );
};

export default DatePage;
