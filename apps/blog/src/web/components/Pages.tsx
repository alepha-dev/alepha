import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconEye,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";

const pages = [
  {
    id: 1,
    title: "Home",
    author: "Nicolas F.",
    status: "published",
    template: "Full Width",
    date: "Jan 15, 2026",
    order: 1,
  },
  {
    id: 2,
    title: "About Us",
    author: "Nicolas F.",
    status: "published",
    template: "Default",
    date: "Jan 15, 2026",
    order: 2,
  },
  {
    id: 3,
    title: "Blog",
    author: "Nicolas F.",
    status: "published",
    template: "Blog Archive",
    date: "Jan 15, 2026",
    order: 3,
  },
  {
    id: 4,
    title: "Contact",
    author: "Marie L.",
    status: "published",
    template: "Contact Form",
    date: "Jan 20, 2026",
    order: 4,
  },
  {
    id: 5,
    title: "Privacy Policy",
    author: "Nicolas F.",
    status: "published",
    template: "Default",
    date: "Jan 15, 2026",
    order: 5,
  },
  {
    id: 6,
    title: "Terms of Service",
    author: "Nicolas F.",
    status: "published",
    template: "Default",
    date: "Jan 15, 2026",
    order: 6,
  },
  {
    id: 7,
    title: "Documentation",
    author: "Alex K.",
    status: "published",
    template: "Docs Layout",
    date: "Feb 1, 2026",
    order: 7,
  },
  {
    id: 8,
    title: "Changelog",
    author: "Alex K.",
    status: "draft",
    template: "Default",
    date: "Feb 3, 2026",
    order: 8,
  },
  {
    id: 9,
    title: "Pricing",
    author: "Sarah M.",
    status: "draft",
    template: "Full Width",
    date: "Feb 4, 2026",
    order: 9,
  },
];

const statusColor: Record<string, string> = {
  published: "teal",
  draft: "gray",
};

const Pages = () => {
  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Pages
        </Title>
        <Group gap="sm">
          <TextInput
            placeholder="Search pages..."
            leftSection={<IconSearch size={14} />}
            size="xs"
            w={200}
          />
          <Button
            leftSection={<IconPlus size={14} />}
            color="orange"
            size="sm"
            onClick={() =>
              notifications.show({
                title: "New Page",
                message: "Opening page editor...",
                color: "blue",
              })
            }
          >
            Add New
          </Button>
        </Group>
      </Group>

      {/* Table */}
      <Box
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Table
          highlightOnHover
          styles={{
            th: {
              fontSize: 12,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              borderBottom: "1px solid var(--mantine-color-default-border)",
              padding: "10px 16px",
            },
            td: {
              padding: "10px 16px",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Title</Table.Th>
              <Table.Th>Author</Table.Th>
              <Table.Th>Template</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pages.map((page) => (
              <Table.Tr key={page.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {page.title}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {page.author}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="outline" color="gray" size="xs">
                    {page.template}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge
                    variant="light"
                    color={statusColor[page.status]}
                    size="sm"
                  >
                    {page.status}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {page.date}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Menu shadow="md" width={160} position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" size="sm">
                        <IconDotsVertical size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() =>
                          notifications.show({
                            title: "Edit",
                            message: "Opening page editor...",
                            color: "blue",
                          })
                        }
                      >
                        Edit
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconEye size={14} />}
                        onClick={() =>
                          notifications.show({
                            title: "Preview",
                            message: "Opening page preview...",
                            color: "blue",
                          })
                        }
                      >
                        View
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconCopy size={14} />}
                        onClick={() =>
                          notifications.show({
                            title: "Duplicated",
                            message: "Page duplicated successfully.",
                            color: "teal",
                          })
                        }
                      >
                        Duplicate
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<IconTrash size={14} />}
                        color="red"
                        onClick={() =>
                          modals.openConfirmModal({
                            title: "Delete page",
                            children: (
                              <Text size="sm">
                                Are you sure you want to delete &ldquo;
                                {page.title}&rdquo;? This action cannot be
                                undone.
                              </Text>
                            ),
                            labels: { confirm: "Delete", cancel: "Cancel" },
                            confirmProps: { color: "red" },
                            onConfirm: () =>
                              notifications.show({
                                title: "Deleted",
                                message: "Page moved to trash.",
                                color: "red",
                              }),
                          })
                        }
                      >
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>

      <Group justify="flex-end" mt="md">
        <Text size="xs" c="dimmed">
          {pages.length} pages total
        </Text>
      </Group>
    </Box>
  );
};

export default Pages;
