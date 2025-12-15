import { useClient } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { type Page, t } from "alepha";
import { type FileController, type FileEntity, files } from "alepha/api/files";

const AdminFiles = () => {
  const client = useClient<FileController>();
  const { l } = useI18n();

  const filters = t.object({
    bucket: t.optional(t.string()),
    name: t.optional(
      t.string({
        $control: {
          query: t.pick(files.schema, ["name", "bucket", "mimeType"]),
        },
      }),
    ),
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <Flex flex={1} direction={"column"}>
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
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="light" color="blue">
                {item.bucket}
              </Badge>
            ),
          },
          mimeType: {
            label: "Type",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.mimeType}
              </Text>
            ),
          },
          size: {
            label: "Size",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {formatFileSize(item.size)}
              </Text>
            ),
          },
          creatorName: {
            label: "Creator",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.creatorName || "-"}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />
    </Flex>
  );
};

export default AdminFiles;
