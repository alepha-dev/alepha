import {
  Badge,
  Card,
  Container,
  Divider,
  Flex,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconPlane, IconTrain } from "@tabler/icons-react";
import { motion } from "framer-motion";

export const ComparisonSection = () => {
  return (
    <Container size="lg" py={80}>
      <SimpleGrid
        cols={{ base: 1, md: 2 }}
        spacing={60}
        style={{ alignItems: "center" }}
      >
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Stack gap="lg">
            <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
              Toronto to Montreal
            </Text>
            <Title order={2} fz={36} fw={700}>
              Skip the airport hassle
            </Title>
            <Text size="lg" c="dimmed" lh={1.7}>
              No security lines, no baggage fees, no stress. Board downtown
              Toronto and arrive in the heart of Montreal. Work, relax, or enjoy
              the scenic Canadian landscape.
            </Text>
            <Group gap="md">
              <Badge size="lg" variant="light" color="green" radius="md">
                Zero Emissions
              </Badge>
              <Badge size="lg" variant="light" color="dark" radius="md">
                Downtown to Downtown
              </Badge>
            </Group>
          </Stack>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card
            withBorder
            radius="lg"
            p="xl"
            bg="var(--alepha-elevated)"
            bd="1px solid var(--alepha-border)"
          >
            <Stack gap="lg">
              <Group justify="space-between">
                <Group gap="sm">
                  <Flex
                    w={40}
                    h={40}
                    align="center"
                    justify="center"
                    bg="red.0"
                    style={{ borderRadius: 10 }}
                  >
                    <IconPlane size={20} color="var(--mantine-color-red-6)" />
                  </Flex>
                  <Text fw={600}>Flying</Text>
                </Group>
                <Text c="dimmed" size="sm">
                  ~3h 30min total
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                Drive to airport + security + boarding + flight + baggage +
                transit
              </Text>

              <Divider color="var(--alepha-border)" />

              <Group justify="space-between">
                <Group gap="sm">
                  <Flex
                    w={40}
                    h={40}
                    align="center"
                    justify="center"
                    bg="green.0"
                    style={{ borderRadius: 10 }}
                  >
                    <IconTrain size={20} color="var(--mantine-color-green-6)" />
                  </Flex>
                  <Text fw={600}>AlephaRail</Text>
                </Group>
                <Text c="green" size="sm" fw={600}>
                  2h 30min
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                Walk to platform, board, arrive downtown Montreal
              </Text>
            </Stack>
          </Card>
        </motion.div>
      </SimpleGrid>
    </Container>
  );
};
