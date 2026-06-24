import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const schema = z.object({
  birthday: z
    .string()
    .meta({ format: "date", title: "Birthday", $control: { width: 50 } })
    .describe("Date-only — shadcn Calendar via react-day-picker."),
  meetingAt: z
    .string()
    .meta({ format: "date-time", title: "Meeting at", $control: { width: 50 } })
    .describe("Date + native time picker."),
  alarm: z
    .string()
    .meta({ format: "time", title: "Alarm", $control: { width: 50 } })
    .describe("Time-only — native input."),
});

const DatesForm = () => {
  const toast = useToast();
  const form = useForm({
    schema,
    handler: (values) => toast.success(JSON.stringify(values, null, 2)),
  });

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <AutoForm
        form={form}
        icon="user"
        title="Date / time variants"
        description="Driven by JSON-Schema format. shadcn Calendar = react-day-picker."
      />
    </div>
  );
};

export default DatesForm;
