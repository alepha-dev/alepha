import { Box, Container, SimpleGrid, Stack, Text } from "@mantine/core";
import { motion } from "framer-motion";

const stats = [
  { value: "300", label: "km/h Top Speed" },
  { value: "12", label: "Major Cities" },
  { value: "100%", label: "Accessible" },
  { value: "0", label: "Carbon Emissions" },
];

export const StatsSection = () => {
  return (
    <Box
      bg="var(--alepha-elevated)"
      py={60}
      bd="1px solid var(--alepha-border)"
      style={{ borderLeft: 0, borderRight: 0 }}
    >
      <Container size="lg">
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Stack align="center" gap={4}>
                <Text
                  fz={48}
                  fw={700}
                  lh={1}
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {stat.value}
                </Text>
                <Text size="sm" c="dimmed">
                  {stat.label}
                </Text>
              </Stack>
            </motion.div>
          ))}
        </SimpleGrid>
      </Container>
    </Box>
  );
};
