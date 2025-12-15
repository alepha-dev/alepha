import {
  Avatar,
  Box,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { motion } from "framer-motion";
import { cardHover } from "./animations.ts";

const testimonials = [
  {
    name: "Sarah T.",
    role: "Toronto, ON",
    text: "Finally, a fast and sustainable way to travel between Toronto and Montreal. The accessibility features are excellent.",
  },
  {
    name: "Jean-Pierre L.",
    role: "Montreal, QC",
    text: "Je voyage chaque semaine pour le travail. AlephaRail a changé ma vie - rapide, confortable et écologique.",
  },
  {
    name: "Michael C.",
    role: "Vancouver, BC",
    text: "As a wheelchair user, I appreciate how AlephaRail was designed with accessibility in mind from day one.",
  },
];

export const TestimonialsSection = () => {
  return (
    <Box
      bg="var(--alepha-elevated)"
      py={80}
      style={{ borderTop: "1px solid var(--alepha-border)" }}
    >
      <Container size="lg">
        <Stack gap={40}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Stack align="center" gap="xs">
              <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
                Testimonials
              </Text>
              <Title order={2} ta="center" fz={36} fw={700}>
                Loved by Canadians
              </Title>
            </Stack>
          </motion.div>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            {testimonials.map((testimonial, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={cardHover}
              >
                <Card
                  withBorder
                  radius="lg"
                  p="xl"
                  h="100%"
                  bg="var(--alepha-background)"
                  bd="1px solid var(--alepha-border)"
                >
                  <Stack gap="lg" h="100%" justify="space-between">
                    <Text size="md" lh={1.7} c="dimmed">
                      "{testimonial.text}"
                    </Text>
                    <Group gap="sm">
                      <Avatar color="dark" radius="xl" size="md">
                        {testimonial.name.charAt(0)}
                      </Avatar>
                      <Stack gap={0}>
                        <Text fw={600} size="sm">
                          {testimonial.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {testimonial.role}
                        </Text>
                      </Stack>
                    </Group>
                  </Stack>
                </Card>
              </motion.div>
            ))}
          </SimpleGrid>
        </Stack>
      </Container>
    </Box>
  );
};
