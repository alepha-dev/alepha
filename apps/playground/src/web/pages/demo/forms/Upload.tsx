import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const schema = z.object({
  avatar: z
    .string()
    .meta({
      title: "Avatar",
      $control: {
        upload: { accept: "image/*", maxSize: 1_000_000 },
      },
    })
    .describe("Single image, max 1 MB. Stored as a UUID in the form.")
    .optional(),
  attachments: z
    .array(z.string())
    .meta({
      title: "Attachments",
      $control: {
        upload: { multi: true },
      },
    })
    .describe("Drag-drop several files at once.")
    .optional(),
  resume: z
    .string()
    .meta({
      title: "Resume",
      $control: { upload: { accept: ".pdf,application/pdf" } },
    })
    .describe("PDFs only.")
    .optional(),
});

const UploadDemo = () => {
  const toast = useToast();
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
