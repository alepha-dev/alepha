import { DataTable, Flex, Text, useDialog, useToast } from "@alepha/mantine";
import { HoverCard } from "@mantine/core";
import {
  IconDownload,
  IconFile,
  IconFileCode,
  IconFileMusic,
  IconFileSpreadsheet,
  IconFileText,
  IconFileZip,
  IconPdf,
  IconPhoto,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { FileController, FileEntity } from "alepha/api/files";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

const AdminFiles = () => {
  const client = useClient<FileController>();
  const { l } = useI18n();
  const dialog = useDialog();
  const toast = useToast();

  const filters = t.object({
    bucket: t.optional(t.string()),
    name: t.optional(t.string()),
  });

  const isImage = (mime: string) => mime.startsWith("image/");

  const getFileIcon = (mime: string) => {
    if (isImage(mime)) return IconPhoto;
    if (mime === "application/pdf") return IconPdf;
    if (mime.startsWith("video/")) return IconVideo;
    if (mime.startsWith("audio/")) return IconFileMusic;
    if (mime.startsWith("text/csv") || mime.includes("spreadsheet"))
      return IconFileSpreadsheet;
    if (
      mime.includes("zip") ||
      mime.includes("tar") ||
      mime.includes("gzip") ||
      mime.includes("compress")
    )
      return IconFileZip;
    if (
      mime.includes("javascript") ||
      mime.includes("json") ||
      mime.includes("xml") ||
      mime.includes("html") ||
      mime.includes("css")
    )
      return IconFileCode;
    if (mime.startsWith("text/")) return IconFileText;
    return IconFile;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <Flex p="md" flex={1} direction={"column"}>
      <DataTable<FileEntity, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
        onFilterChange={(key, _value, form) => {
          if (key === "name" || key === "bucket") {
            return form.submit();
          }
        }}
        filters={filters}
        items={async (filters) => {
          const response = await client.findFiles({
            query: filters,
          });

          return response as Page<FileEntity>;
        }}
        columns={{
          preview: {
            label: "",
            fit: true,
            value: (item) => {
              const Icon = getFileIcon(item.mimeType);
              const url = `/api/files/${item.id}`;

              if (isImage(item.mimeType)) {
                return (
                  <HoverCard
                    width={512}
                    position="right"
                    shadow="lg"
                    openDelay={200}
                  >
                    <HoverCard.Target>
                      <img
                        src={url}
                        alt={item.name}
                        style={{
                          width: 32,
                          height: 32,
                          objectFit: "cover",
                          borderRadius: 4,
                          display: "block",
                        }}
                      />
                    </HoverCard.Target>
                    <HoverCard.Dropdown p={4}>
                      <img
                        src={url}
                        alt={item.name}
                        style={{
                          width: 512,
                          height: 512,
                          objectFit: "contain",
                          display: "block",
                        }}
                      />
                    </HoverCard.Dropdown>
                  </HoverCard>
                );
              }

              return <Icon size={20} color="var(--mantine-color-dimmed)" />;
            },
          },
          name: {
            label: "Name",
            value: (item) => (
              <Text size="sm" fw={500} lineClamp={1}>
                {item.name}
              </Text>
            ),
          },
          bucket: {
            label: "Bucket",
            value: (item) => (
              <Text size="xs" ff="monospace">
                {item.bucket}
              </Text>
            ),
          },
          mimeType: {
            label: "Type",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.mimeType}
              </Text>
            ),
          },
          size: {
            label: "Size",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {formatFileSize(item.size)}
              </Text>
            ),
          },
          creatorName: {
            label: "Creator",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.creatorName || "-"}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
        rowActions={(item) => [
          {
            label: "Download",
            icon: IconDownload,
            skipRefresh: true,
            onClick: () => {
              window.open(`/api/files/${item.id}`, "_blank");
            },
          },
        ]}
        checkboxActions={[
          {
            label: "Delete selected",
            icon: <IconTrash size={14} />,
            intent: "danger",
            onClick: async ({ selectedItems, clearSelection }) => {
              const confirmed = await dialog.confirm({
                title: "Delete files",
                message: `Permanently delete ${selectedItems.length} file(s)? This action cannot be undone.`,
              });
              if (!confirmed) return;
              for (const file of selectedItems) {
                await client.deleteFile({ params: { id: file.id } });
              }
              toast.success({
                message: `${selectedItems.length} file(s) deleted`,
              });
              clearSelection();
            },
          },
        ]}
      />
    </Flex>
  );
};

export default AdminFiles;
