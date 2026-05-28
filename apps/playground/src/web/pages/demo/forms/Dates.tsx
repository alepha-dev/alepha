import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { t } from "alepha";
import { useForm } from "alepha/react/form";

const schema = t.object({
  birthday: t.string({
    format: "date",
    title: "Birthday",
    description: "Date-only — shadcn Calendar via react-day-picker.",
    $control: { width: 50 },
  }),
  meetingAt: t.string({
    format: "date-time",
    title: "Meeting at",
    description: "Date + native time picker.",
    $control: { width: 50 },
  }),
  alarm: t.string({
    format: "time",
    title: "Alarm",
    description: "Time-only — native input.",
    $control: { width: 50 },
  }),
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
