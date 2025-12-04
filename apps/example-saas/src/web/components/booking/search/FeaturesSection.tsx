import {
  Card,
  Container,
  Flex,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAccessible,
  IconBolt,
  IconLeaf,
  IconWorld,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { cardHover } from "./animations.ts";

const features = [
  {
    icon: IconLeaf,
    title: "Zero Emissions",
    desc: "100% electric trains powered by renewable Canadian energy sources",
  },
  {
    icon: IconBolt,
    title: "High-Speed",
    desc: "Travel at speeds up to 300 km/h between major Canadian cities",
  },
  {
    icon: IconAccessible,
    title: "Fully Accessible",
    desc: "Wheelchair spaces, audio announcements, and assistance at every station",
  },
  {
    icon: IconWorld,
    title: "Downtown to Downtown",
    desc: "Arrive directly in city centers, no airport transfers needed",
  },
];

export const FeaturesSection = () => {
  return (
    <Container size="lg" py={80}>
      <Stack gap={60}>
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Stack align="center" gap="xs">
            <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
              Why Choose Vectura
            </Text>
            <Title order={2} ta="center" fz={36} fw={700}>
              Built for all Canadians
            </Title>
          </Stack>
        </motion.div>

        {/* Feature cards */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
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
                h="100%"
                bg="var(--alepha-elevated)"
                bd="1px solid var(--alepha-border)"
              >
                <Stack gap="md">
                  <Flex
                    w={48}
                    h={48}
                    align="center"
                    justify="center"
                    bg="var(--alepha-surface)"
                    style={{ borderRadius: 12 }}
                  >
                    <feature.icon size={24} stroke={1.5} />
                  </Flex>
                  <Text fw={600} size="lg">
                    {feature.title}
                  </Text>
                  <Text size="sm" c="dimmed" lh={1.6}>
                    {feature.desc}
                  </Text>
                </Stack>
              </Card>
            </motion.div>
          ))}
        </SimpleGrid>
      </Stack>
    </Container>
  );
};
