import { ActionButton, Flex } from "@alepha/ui";
import {
  Badge,
  ColorInput,
  Modal,
  Skeleton,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDots, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useState } from "react";
import type { AdminCategoryController } from "../../api/controllers/AdminCategoryController.ts";
import type { CategoryController } from "../../api/controllers/CategoryController.ts";
import type { CategoryResource } from "../../api/schemas/categorySchemas.ts";

export interface AdminCategoriesProps {
  initialCategories: CategoryResource[];
}

const AdminCategories = ({ initialCategories }: AdminCategoriesProps) => {
  const catClient = useClient<CategoryController>();
  const adminCatClient = useClient<AdminCategoryController>();

  const [categories, setCategories] =
    useState<CategoryResource[]>(initialCategories);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await catClient.listCategories({});
      setCategories(res as CategoryResource[]);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setSlug("");
    setDescription("");
    setColor("");
    setModalOpen(true);
  };

  const openEdit = (cat: CategoryResource) => {
    setEditingId(cat.id);
    setName(cat.name);
    setSlug(cat.slug);
    setDescription(cat.description || "");
    setColor(cat.color || "");
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = {
        name,
        slug: slug || undefined,
        description: description || undefined,
        color: color || undefined,
      };
      if (editingId) {
        await adminCatClient.updateCategory({
          params: { id: editingId },
          body: data,
        });
      } else {
        await adminCatClient.createCategory({ body: data });
      }
      setModalOpen(false);
      load();
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    await adminCatClient.deleteCategory({ params: { id } });
    load();
  };

  return (
    <Flex direction="column" gap="lg" p="lg">
      <Flex justify="space-between">
        <Title order={2}>Categories</Title>
        <ActionButton
          icon={IconPlus}
          color="dark"
          radius="sm"
          onClick={openCreate}
        >
          New Category
        </ActionButton>
      </Flex>

      {loading ? (
        <Flex direction="column" gap="xs">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} h={48} />
          ))}
        </Flex>
      ) : categories.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No categories yet. Create your first!
        </Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Slug</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Color</Table.Th>
              <Table.Th w={60} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {categories.map((cat) => (
              <Table.Tr key={cat.id}>
                <Table.Td>
                  <Text fz="sm" fw={500}>
                    {cat.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text fz="sm" c="dimmed">
                    {cat.slug}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text fz="sm" c="dimmed" lineClamp={1}>
                    {cat.description || "-"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {cat.color ? (
                    <Badge
                      size="sm"
                      variant="filled"
                      style={{ backgroundColor: cat.color }}
                    >
                      {cat.color}
                    </Badge>
                  ) : (
                    <Text fz="sm" c="dimmed">
                      -
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <ActionButton
                    icon={IconDots}
                    variant="subtle"
                    color="gray"
                    size="sm"
                    menu={{
                      position: "bottom-end",
                      items: [
                        {
                          label: "Edit",
                          icon: <IconEdit size={14} />,
                          onClick: () => openEdit(cat),
                        },
                        {
                          label: "Delete",
                          icon: <IconTrash size={14} />,
                          color: "red",
                          onClick: () => deleteCategory(cat.id),
                        },
                      ],
                    }}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Category" : "New Category"}
        size="md"
      >
        <Flex direction="column" gap="md">
          <TextInput
            label="Name"
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Slug"
            placeholder="Auto-generated from name"
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
          />
          <Textarea
            label="Description"
            placeholder="Brief description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            minRows={2}
          />
          <ColorInput
            label="Color"
            placeholder="Pick a color"
            value={color}
            onChange={setColor}
          />
          <Flex justify="flex-end">
            <ActionButton
              variant="outline"
              color="gray"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </ActionButton>
            <ActionButton
              color="dark"
              loading={saving}
              onClick={save}
              disabled={!name.trim()}
            >
              {editingId ? "Update" : "Create"}
            </ActionButton>
          </Flex>
        </Flex>
      </Modal>
    </Flex>
  );
};

export default AdminCategories;
