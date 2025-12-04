import {
  Badge,
  Box,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAccessible,
  IconLeaf,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { fadeIn, staggerContainer } from "./animations.ts";

export const HeroSection = () => {
  return (
    <Box bg="dark.9" pos="relative" style={{ overflow: "hidden" }}>
      {/* Subtle grid pattern */}
      <Box
        pos="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
        }}
      />

      <motion.div
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <Container size="lg" py={100} pos="relative">
          <Stack align="center" gap="xl">
            {/* Badge */}
            <motion.div variants={fadeIn}>
              <Badge
                size="lg"
                variant="outline"
                color="gray"
                radius="xl"
                leftSection={<IconSparkles size={14} />}
                styles={{
                  root: {
                    borderColor: "rgba(255,255,255,0.2)",
                    color: "rgba(255,255,255,0.7)",
                    textTransform: "none",
                    fontWeight: 500,
                  },
                }}
              >
                Government of Canada Initiative
              </Badge>
            </motion.div>

            {/* Main heading */}
            <motion.div variants={fadeIn}>
              <Title
                order={1}
                c="white"
                ta="center"
                fz={{ base: 40, sm: 56, md: 72 }}
                fw={700}
                lh={1.1}
                style={{ letterSpacing: "-0.03em" }}
              >
                Connect Canada
                <br />
                <Text
                  span
                  inherit
                  variant="gradient"
                  gradient={{ from: "gray.5", to: "white", deg: 90 }}
                >
                  at High Speed
                </Text>
              </Title>
            </motion.div>

            {/* Subtitle */}
            <motion.div variants={fadeIn}>
              <Text c="dark.2" size="xl" ta="center" maw={540} lh={1.6}>
                Vectura is Canada's new high-speed rail network. Sustainable,
                accessible, and connecting major cities in record time.
              </Text>
            </motion.div>

            {/* Trust indicators */}
            <motion.div variants={fadeIn}>
              <Group gap="xl" mt="md">
                {[
                  { icon: IconLeaf, text: "Carbon Neutral" },
                  { icon: IconAccessible, text: "Fully Accessible" },
                  { icon: IconShieldCheck, text: "Government Backed" },
                ].map((item) => (
                  <Group key={item.text} gap={6}>
                    <item.icon size={16} color="var(--mantine-color-dark-3)" />
                    <Text size="sm" c="dark.3">
                      {item.text}
                    </Text>
                  </Group>
                ))}
              </Group>
            </motion.div>
          </Stack>
        </Container>
      </motion.div>
    </Box>
  );
};
