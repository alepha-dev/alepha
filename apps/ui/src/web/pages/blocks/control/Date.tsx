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
  // Neither of these carries a `.describe()`, and that is not an oversight: a
  // filter row is the shape being shown, and a filter has no description.
  period: z.dateRange().meta({ title: "Period" }).optional(),
  status: z.enum(["open", "closed"]).meta({ title: "Status" }).optional(),
  // The pair below is the regression guard for the clear `x`'s position - see
  // the group that renders them.
  window: z
    .dateRange()
    .meta({ title: "Window" })
    .describe("A narrowed trigger in a field that is the whole form wide.")
    .optional(),
  zone: z
    .enum(["eu-west", "us-east"])
    .meta({ title: "Zone" })
    .describe("The same shape, for a select rather than a calendar.")
    .optional(),
});

const DatePage = () => {
  const form = useForm(
    {
      schema,
      handler: () => {},
      // The two guard fields start FILLED, because the thing they exist to
      // show - the clear `x` - is only drawn once a field has a value, and a
      // showcase that needs a two-click gesture before it shows anything is a
      // showcase nobody checks. Literal days rather than ones derived from
      // today: a fixture that moves with the clock reads differently tomorrow.
      initialValues: { window: ["2026-01-05", "2026-01-19"], zone: "eu-west" },
    },
    [schema],
  );

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

            {/*
              ⚠️ The regression guard for #Q2283, and it has to be a FORM row
              rather than the filter row above it. A `FormField` is as wide as
              the box it sits in: on the filter row that box shrinks to the
              trigger, so nothing shows there, while here it is the form's own
              672px and the trigger is 256px of it.

              The clear `x` used to be positioned against the FIELD, so on
              this row it sat some 400px right of the control it belongs to.
              It follows the trigger's own right edge now, whatever the field
              around it measures.
            */}
            <Group title="Narrowed, inside a full-width form">
              <Control
                input={form.input.window}
                clearable
                disabled={v.disabled}
                triggerClassName="w-64"
              />
              <Control
                input={form.input.zone}
                clearable
                disabled={v.disabled}
                triggerClassName="w-40"
              />
            </Group>
          </div>
        );
      }}
    </Showcase>
  );
};

export default DatePage;
