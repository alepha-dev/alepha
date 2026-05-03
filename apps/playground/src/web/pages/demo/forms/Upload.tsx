import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { t } from "alepha";
import { useForm } from "alepha/react/form";
import { toast } from "sonner";

const schema = t.object({
  avatar: t.optional(
    t.string({
      title: "Avatar",
      description: "Single image, max 1 MB. Stored as a UUID in the form.",
      $control: {
        upload: { accept: "image/*", maxSize: 1_000_000 },
      },
    }),
  ),
  attachments: t.optional(
    t.array(t.string(), {
      title: "Attachments",
      description: "Drag-drop several files at once.",
      $control: {
        upload: { multi: true },
      },
    }),
  ),
  resume: t.optional(
    t.string({
      title: "Resume",
      description: "PDFs only.",
      $control: { upload: { accept: ".pdf,application/pdf" } },
    }),
  ),
});

const UploadDemo = () => {
  const form = useForm({
    schema,
    handler: (values) => {
      toast.success(JSON.stringify(values, null, 2));
    },
  });

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <AutoForm
        form={form}
        icon="user"
        title="File uploads"
        description="control-upload calls FileController.uploadFile and stores the resulting file ID(s) in the form value."
      />
    </div>
  );
};

export default UploadDemo;
