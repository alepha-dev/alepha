import type { CustomControlProps } from "@alepha/ui";
import { ActionButton, Flex, useToast } from "@alepha/ui";
import { Loader } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { type ChangeEvent, useRef, useState } from "react";
import type { TaskController } from "../../../../../api/controllers/TaskController.ts";
import AttachmentBadge from "./AttachmentBadge.tsx";

const ACCEPTED_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.doc,.docx";

interface TaskAttachmentsProps extends CustomControlProps {
  disabled?: boolean;
}

const TaskAttachments = (props: TaskAttachmentsProps) => {
  const { defaultValue, onChange, disabled } = props;
  const attachments: string[] = defaultValue || [];
  const toast = useToast();
  const taskApi = useClient<TaskController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localAttachments, setLocalAttachments] =
    useState<string[]>(attachments);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const result = await taskApi.uploadAttachment({
          body: { file },
        });
        return result.fileId;
      });

      const newFileIds = await Promise.all(uploadPromises);
      const updated = [...localAttachments, ...newFileIds];
      setLocalAttachments(updated);
      onChange(updated);

      toast.success({
        message: `${files.length} file(s) uploaded successfully`,
      });
    } catch (error) {
      toast.danger({
        message: (error as Error)?.message || "Failed to upload file(s)",
      });
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
    onChange(updated);
  };

  return (
    <Flex direction="column" gap="xs" w="100%">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: "none" }}
        disabled={disabled}
      />

      {localAttachments.length > 0 && (
        <Flex gap="xs" wrap="wrap">
          {localAttachments.map((fileId) => (
            <AttachmentBadge
              key={fileId}
              fileId={fileId}
              onRemove={disabled ? undefined : handleRemove}
              disabled={disabled}
            />
          ))}
        </Flex>
      )}

      {!disabled && (
        <ActionButton
          variant="light"
          size="sm"
          leftSection={
            uploading ? <Loader size={16} /> : <IconUpload size={16} />
          }
          onClick={handleUploadClick}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Attach Files"}
        </ActionButton>
      )}
    </Flex>
  );
};

export default TaskAttachments;
