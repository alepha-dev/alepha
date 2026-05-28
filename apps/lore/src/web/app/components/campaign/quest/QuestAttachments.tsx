import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { Loader2, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import AttachmentBadge from "./AttachmentBadge.tsx";

const ACCEPTED_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.doc,.docx";

export interface QuestAttachmentsProps {
  value?: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

const QuestAttachments = (props: QuestAttachmentsProps) => {
  const questApi = useClient<QuestController>();
  const toaster = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localAttachments, setLocalAttachments] = useState<string[]>(
    props.value ?? [],
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const result = await questApi.uploadAttachment({ body: { file } });
        return result.fileId;
      });

      const newFileIds = await Promise.all(uploadPromises);
      const updated = [...localAttachments, ...newFileIds];
      setLocalAttachments(updated);
      props.onChange(updated);

      toaster.success(`${files.length} file(s) uploaded successfully`);
    } catch (error) {
      toaster.error((error as Error)?.message || "Failed to upload file(s)");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemove = (fileId: string) => {
    const updated = localAttachments.filter((id) => id !== fileId);
    setLocalAttachments(updated);
    props.onChange(updated);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={ACCEPTED_TYPES}
        multiple
        className="hidden"
        disabled={props.disabled}
      />

      {localAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {localAttachments.map((fileId) => (
            <AttachmentBadge
              key={fileId}
              fileId={fileId}
              onRemove={props.disabled ? undefined : handleRemove}
              disabled={props.disabled}
            />
          ))}
        </div>
      )}

      {!props.disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUploadClick}
          disabled={uploading}
          className="self-start"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading ? "Uploading..." : "Attach Files"}
        </Button>
      )}
    </div>
  );
};

export default QuestAttachments;
