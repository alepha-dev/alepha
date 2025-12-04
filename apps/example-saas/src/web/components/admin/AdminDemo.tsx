import { useClient } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Alert,
  Badge,
  Card,
  Container,
  Group,
  Stack,
  Title,
} from "@mantine/core";
import {
  IconDatabase,
  IconGlobe,
  IconInfoCircle,
  IconMapPin,
  IconRoute,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import type { AdminController } from "../../../api/controllers/AdminController.ts";

interface SeedSet {
  id: string;
  name: string;
  stationsCount: number;
  tripsCount: number;
}

interface SeedResult {
  ok: boolean;
  setName: string;
  stations: number;
  trips: number;
}

export interface AdminDemoProps {
  seedSets: SeedSet[];
}

const AdminDemo = (props: AdminDemoProps) => {
  const { seedSets } = props;
  const client = useClient<AdminController>();

  const [seedLoading, setSeedLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [clearResult, setClearResult] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSeed = async (setId: string) => {
    setSeedLoading(true);
    setSeedResult(null);
    setClearResult(false);
    setError(null);
    try {
      const result = await client.seed({ params: { setId } });
      setSeedResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSeedLoading(false);
    }
  };

  const handleClear = async () => {
    setClearLoading(true);
    setSeedResult(null);
    setClearResult(false);
    setError(null);
    try {
      await client.clear({});
      setClearResult(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Flex direction="column" align="center" gap="md">
          <IconDatabase size={48} stroke={1.5} />
          <Title order={1}>Admin Demo</Title>
          <Text c="dimmed" ta="center" maw={500}>
            Manage seed data for the train booking system. Choose a region to
            populate the database with sample stations and trips.
          </Text>
        </Flex>

        {seedResult && (
          <Alert
            icon={<IconInfoCircle size={16} />}
            title="Seed Complete"
            color="green"
          >
            Successfully seeded {seedResult.setName}: {seedResult.stations}{" "}
            stations and {seedResult.trips} trips created.
          </Alert>
        )}

        {clearResult && (
          <Alert
            icon={<IconInfoCircle size={16} />}
            title="Clear Complete"
            color="blue"
          >
            All data has been cleared from the database.
          </Alert>
        )}

        {error && (
          <Alert icon={<IconInfoCircle size={16} />} title="Error" color="red">
            {error}
          </Alert>
        )}

        <Title order={3}>Seed Data Sets</Title>

        <Group gap="md">
          {seedSets.map((set) => (
            <Card key={set.id} withBorder radius="md" p="lg" w={280}>
              <Stack gap="md">
                <Group justify="space-between">
                  <Group gap="xs">
                    <IconGlobe size={20} />
                    <Text fw={600}>{set.name}</Text>
                  </Group>
                  <Badge variant="light">{set.id}</Badge>
                </Group>

                <Stack gap="xs">
                  <Group gap="xs">
                    <IconMapPin size={14} />
                    <Text size="sm" c="dimmed">
                      {set.stationsCount} stations
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <IconRoute size={14} />
                    <Text size="sm" c="dimmed">
                      {set.tripsCount} trips
                    </Text>
                  </Group>
                </Stack>

                <ActionButton
                  fullWidth
                  leftSection={<IconDatabase size={16} />}
                  onClick={() => handleSeed(set.id)}
                  loading={seedLoading}
                >
                  Seed {set.name}
                </ActionButton>
              </Stack>
            </Card>
          ))}
        </Group>

        <Title order={3}>Danger Zone</Title>

        <Card withBorder radius="md" p="lg">
          <Stack gap="md">
            <Group gap="xs">
              <IconTrash size={20} color="var(--mantine-color-red-6)" />
              <Text fw={600} c="red.6">
                Clear All Data
              </Text>
            </Group>

            <Text size="sm" c="dimmed">
              This will permanently delete all stations, trips, and bookings
              from the database. This action cannot be undone.
            </Text>

            <ActionButton
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={handleClear}
              loading={clearLoading}
            >
              Clear Database
            </ActionButton>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
};

export default AdminDemo;
