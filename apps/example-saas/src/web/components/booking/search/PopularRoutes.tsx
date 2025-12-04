import {
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight, IconClock } from "@tabler/icons-react";
import { motion } from "framer-motion";
import type { Trip } from "../../../../api/schemas/tripSchema.ts";
import { cardHover } from "./animations.ts";

export interface PopularRoutesProps {
  routes: Trip[];
  onRouteSelect: (route: Trip) => void;
}

export const PopularRoutes = (props: PopularRoutesProps) => {
  const { routes, onRouteSelect } = props;

  if (routes.length === 0) return null;

  return (
    <Container size="lg" py={80}>
      <Stack gap={40}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Group justify="space-between" align="flex-end">
            <Stack gap="xs">
              <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
                Popular Routes
              </Text>
              <Title order={2} fz={36} fw={700}>
                Coast to coast connections
              </Title>
            </Stack>
          </Group>
        </motion.div>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg">
          {routes.map((route, index) => (
            <motion.div
              key={route.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={cardHover}
            >
              <Card
                withBorder
                radius="lg"
                p="lg"
                bg="var(--alepha-elevated)"
                bd="1px solid var(--alepha-border)"
                style={{ cursor: "pointer" }}
                onClick={() => onRouteSelect(route)}
              >
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Text fw={600}>{route.departureStation.split(" ")[0]}</Text>
                    <IconArrowRight
                      size={16}
                      color="var(--alepha-text-muted)"
                    />
                    <Text fw={600}>{route.arrivalStation.split(" ")[0]}</Text>
                  </Group>
                  <Divider color="var(--alepha-border)" />
                  <Group justify="space-between">
                    <Group gap={4}>
                      <IconClock size={14} color="var(--alepha-text-muted)" />
                      <Text size="sm" c="dimmed">
                        {route.duration}
                      </Text>
                    </Group>
                    <Text fw={700}>${route.price} CAD</Text>
                  </Group>
                </Stack>
              </Card>
            </motion.div>
          ))}
        </SimpleGrid>
      </Stack>
    </Container>
  );
};
