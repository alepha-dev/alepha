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
  // ⚠️ Neither of these carries a `.describe()`, and that is not an
  // oversight. `FormField` is as wide as the widest thing in it, the clear
  // `x` is positioned against that box, and a description longer than a
  // `triggerClassName`-narrowed trigger therefore pushes the `x` off the
  // trigger's right edge - for a select exactly as much as for a range, which
  // is why it is not this quest's to fix. A filter row is the shape being
  // shown here, and a filter has no description.
  period: z.dateRange().meta({ title: "Period" }).optional(),
  status: z.enum(["open", "closed"]).meta({ title: "Status" }).optional(),
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

            {/*
              ⚠️ A select sits in this row on purpose. Feedback #2197 was that
              the range picker read as a different kit from the controls beside
              it - a different box, and a clear button hanging off its right
              rather than the `x` a select wears on its trigger. All three draw
              `control-base/field-trigger` now, so the row is the check: same
              height, same border, same `x` in the same place.
            */}
            <Group title="Clearable, the same way">
              <p className="text-muted-foreground text-xs">
                A range, and a select, as a filter row draws them.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Control
                  input={form.input.period}
                  label=""
                  clearable
                  disabled={v.disabled}
                  triggerClassName="w-64"
                  placeholder="Any date"
                />
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  disabled={v.disabled}
                  clearLabel="Any status"
                  triggerClassName="w-40"
                />
              </div>
            </Group>
          </div>
        );
      }}
    </Showcase>
  );
};

export default DatePage;
