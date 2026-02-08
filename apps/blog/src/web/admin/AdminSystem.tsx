import { ActionButton, Flex } from "@alepha/ui";
import { Card, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconCheck,
  IconDatabase,
  IconDatabasePlus,
  IconX,
} from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useState } from "react";
import type { AdminSystemController } from "../../api/controllers/AdminSystemController.ts";

const AdminSystem = () => {
  const systemCtrl = useClient<AdminSystemController>();

  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  const handleSeed = async () => {
    setSeeding(true);
    setResult(null);
    try {
      await systemCtrl.seed({});
      setResult("success");
    } catch {
      setResult("error");
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Flex direction="column" gap="lg" p="lg">
      <Title order={2}>System</Title>

      <Card withBorder radius="sm" p="lg" className="cf-card">
        <Flex gap="sm" mb="md" align="center">
          <ThemeIcon variant="light" color="violet" size="md" radius="sm">
            <IconDatabase size={18} />
          </ThemeIcon>
          <Text fw={600}>Database Seeding</Text>
        </Flex>

        <Text fz="sm" c="dimmed" mb="lg">
          Populate the database with sample blog data: 5 categories, 5 authors,
          30 posts, and comments. This operation is idempotent — running it
          again will have no effect if data already exists.
        </Text>

        <Flex gap="md" align="center">
          <ActionButton
            icon={<IconDatabasePlus size={16} />}
            loading={seeding}
            onClick={handleSeed}
          >
            Seed Database
          </ActionButton>

          {result === "success" && (
            <Flex gap={6} align="center">
              <IconCheck size={16} color="var(--mantine-color-green-6)" />
              <Text fz="sm" c="green" fw={500}>
                Database seeded successfully
              </Text>
            </Flex>
          )}

          {result === "error" && (
            <Flex gap={6} align="center">
              <IconX size={16} color="var(--mantine-color-red-6)" />
              <Text fz="sm" c="red" fw={500}>
                Seeding failed — check server logs
              </Text>
            </Flex>
          )}
        </Flex>
      </Card>
    </Flex>
  );
};

export default AdminSystem;
