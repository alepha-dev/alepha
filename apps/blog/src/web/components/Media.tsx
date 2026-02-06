import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconDownload,
  IconLink,
  IconSearch,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";

const mediaItems = [
  {
    id: 1,
    name: "hero-banner.jpg",
    type: "image",
    size: "2.4 MB",
    dimensions: "1920x1080",
    date: "Feb 5, 2026",
    color: "#3b82f6",
  },
  {
    id: 2,
    name: "alepha-logo.png",
    type: "image",
    size: "124 KB",
    dimensions: "512x512",
    date: "Feb 4, 2026",
    color: "#f6821f",
  },
  {
    id: 3,
    name: "typescript-decorators.png",
    type: "image",
    size: "890 KB",
    dimensions: "1200x630",
    date: "Feb 4, 2026",
    color: "#3178c6",
  },
  {
    id: 4,
    name: "react-19-ssr.jpg",
    type: "image",
    size: "1.1 MB",
    dimensions: "1600x900",
    date: "Feb 2, 2026",
    color: "#61dafb",
  },
  {
    id: 5,
    name: "team-photo.jpg",
    type: "image",
    size: "3.2 MB",
    dimensions: "2400x1600",
    date: "Jan 30, 2026",
    color: "#10b981",
  },
  {
    id: 6,
    name: "cloudflare-workers.png",
    type: "image",
    size: "456 KB",
    dimensions: "800x400",
    date: "Jan 29, 2026",
    color: "#f59e0b",
  },
  {
    id: 7,
    name: "code-screenshot.png",
    type: "image",
    size: "780 KB",
    dimensions: "1400x900",
    date: "Jan 28, 2026",
    color: "#1d1f20",
  },
  {
    id: 8,
    name: "podcast-ep12.mp3",
    type: "audio",
    size: "45.2 MB",
    dimensions: "--",
    date: "Jan 27, 2026",
    color: "#8b5cf6",
  },
  {
    id: 9,
    name: "architecture-diagram.svg",
    type: "image",
    size: "34 KB",
    dimensions: "800x600",
    date: "Jan 26, 2026",
    color: "#ec4899",
  },
  {
    id: 10,
    name: "performance-report.pdf",
    type: "document",
    size: "1.8 MB",
    dimensions: "--",
    date: "Jan 25, 2026",
    color: "#ef4444",
  },
  {
    id: 11,
    name: "og-image-template.psd",
    type: "image",
    size: "12.4 MB",
    dimensions: "1200x630",
    date: "Jan 24, 2026",
    color: "#6366f1",
  },
  {
    id: 12,
    name: "tutorial-video.mp4",
    type: "video",
    size: "156 MB",
    dimensions: "1920x1080",
    date: "Jan 22, 2026",
    color: "#14b8a6",
  },
];

const typeIcons: Record<string, string> = {
  image: "IMG",
  audio: "MP3",
  document: "PDF",
  video: "MP4",
};

const Media = () => {
  const [viewMode, setViewMode] = useState("grid");
  const [selectedItem, setSelectedItem] = useState<
    (typeof mediaItems)[0] | null
  >(null);

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Media Library
        </Title>
        <Button
          leftSection={<IconUpload size={14} />}
          color="orange"
          size="sm"
          onClick={() =>
            notifications.show({
              title: "Upload",
              message: "File upload dialog opened. Select files to upload.",
              color: "blue",
            })
          }
        >
          Upload Files
        </Button>
      </Group>

      {/* Filters */}
      <Group justify="space-between" mb="md">
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={setViewMode}
            data={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
          <Select
            placeholder="All types"
            data={["All types", "Images", "Videos", "Audio", "Documents"]}
            size="xs"
            w={140}
            clearable
          />
          <Select
            placeholder="All dates"
            data={[
              "All dates",
              "February 2026",
              "January 2026",
              "December 2025",
            ]}
            size="xs"
            w={160}
            clearable
          />
        </Group>
        <TextInput
          placeholder="Search media..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          w={220}
        />
      </Group>

      {/* Storage info */}
      <Card withBorder radius="md" p="sm" mb="md">
        <Group justify="space-between">
          <Group gap="lg">
            <Box>
              <Text size="xs" c="dimmed">
                Total Files
              </Text>
              <Text size="sm" fw={600}>
                2,412
              </Text>
            </Box>
            <Divider orientation="vertical" />
            <Box>
              <Text size="xs" c="dimmed">
                Storage Used
              </Text>
              <Text size="sm" fw={600}>
                4.2 GB / 10 GB
              </Text>
            </Box>
            <Divider orientation="vertical" />
            <Box>
              <Text size="xs" c="dimmed">
                Images
              </Text>
              <Text size="sm" fw={600}>
                1,856
              </Text>
            </Box>
            <Divider orientation="vertical" />
            <Box>
              <Text size="xs" c="dimmed">
                Videos
              </Text>
              <Text size="sm" fw={600}>
                48
              </Text>
            </Box>
            <Divider orientation="vertical" />
            <Box>
              <Text size="xs" c="dimmed">
                Documents
              </Text>
              <Text size="sm" fw={600}>
                508
              </Text>
            </Box>
          </Group>
          <Badge variant="light" color="grape" size="sm">
            42% used
          </Badge>
        </Group>
      </Card>

      {/* Grid view */}
      {viewMode === "grid" ? (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="md">
          {/* Upload dropzone */}
          <Box
            style={{
              aspectRatio: "1",
              border: "2px dashed var(--mantine-color-default-border)",
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <IconUpload size={24} color="#9ca3af" />
            <Text size="xs" c="dimmed" mt="xs">
              Drop files
            </Text>
          </Box>

          {mediaItems.map((item) => (
            <Box
              key={item.id}
              className="cf-media-placeholder"
              style={{ backgroundColor: item.color }}
              onClick={() => setSelectedItem(item)}
            >
              <Text>{typeIcons[item.type] || "FILE"}</Text>
            </Box>
          ))}
        </SimpleGrid>
      ) : (
        <Box
          style={{
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {mediaItems.map((item, i) => (
            <Group
              key={item.id}
              justify="space-between"
              px="md"
              py="sm"
              style={{
                borderBottom:
                  i < mediaItems.length - 1
                    ? "1px solid var(--mantine-color-default-border)"
                    : undefined,
                cursor: "pointer",
              }}
              onClick={() => setSelectedItem(item)}
            >
              <Group gap="sm">
                <Box
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    backgroundColor: item.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {typeIcons[item.type]}
                </Box>
                <Box>
                  <Text size="sm" fw={500}>
                    {item.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {item.size}{" "}
                    {item.dimensions !== "--" && `- ${item.dimensions}`}
                  </Text>
                </Box>
              </Group>
              <Group gap="md">
                <Text size="xs" c="dimmed">
                  {item.date}
                </Text>
                <Badge variant="light" color="gray" size="xs">
                  {item.type}
                </Badge>
              </Group>
            </Group>
          ))}
        </Box>
      )}

      {/* Detail modal */}
      <Modal
        opened={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        title={
          <Text fw={600} size="sm">
            Media Details
          </Text>
        }
        size="lg"
      >
        {selectedItem && (
          <SimpleGrid cols={2} spacing="md">
            <Box
              style={{
                backgroundColor: selectedItem.color,
                borderRadius: 8,
                height: 240,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 48,
                fontWeight: 700,
              }}
            >
              {typeIcons[selectedItem.type]}
            </Box>
            <Stack gap="sm">
              <Box>
                <Text size="xs" c="dimmed">
                  File name
                </Text>
                <Text size="sm" fw={500}>
                  {selectedItem.name}
                </Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  File type
                </Text>
                <Text size="sm">{selectedItem.type}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  File size
                </Text>
                <Text size="sm">{selectedItem.size}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Dimensions
                </Text>
                <Text size="sm">{selectedItem.dimensions}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Uploaded
                </Text>
                <Text size="sm">{selectedItem.date}</Text>
              </Box>
              <Divider />
              <Group gap="xs">
                <Button
                  variant="outline"
                  color="gray"
                  size="xs"
                  leftSection={<IconLink size={12} />}
                  onClick={() =>
                    notifications.show({
                      title: "Copied!",
                      message: "File URL copied to clipboard.",
                      color: "teal",
                    })
                  }
                >
                  Copy URL
                </Button>
                <Button
                  variant="outline"
                  color="gray"
                  size="xs"
                  leftSection={<IconDownload size={12} />}
                  onClick={() =>
                    notifications.show({
                      title: "Download",
                      message: "Starting download...",
                      color: "blue",
                    })
                  }
                >
                  Download
                </Button>
                <Button
                  variant="outline"
                  color="red"
                  size="xs"
                  leftSection={<IconTrash size={12} />}
                  onClick={() =>
                    modals.openConfirmModal({
                      title: "Delete file",
                      children: (
                        <Text size="sm">
                          Are you sure you want to delete &ldquo;
                          {selectedItem.name}&rdquo;? This action cannot be
                          undone.
                        </Text>
                      ),
                      labels: { confirm: "Delete", cancel: "Cancel" },
                      confirmProps: { color: "red" },
                      onConfirm: () => {
                        notifications.show({
                          title: "Deleted",
                          message: "File has been deleted.",
                          color: "red",
                        });
                        setSelectedItem(null);
                      },
                    })
                  }
                >
                  Delete
                </Button>
              </Group>
            </Stack>
          </SimpleGrid>
        )}
      </Modal>
    </Box>
  );
};

export default Media;
