import {
  Box,
  Container,
  Divider,
  Flex,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAccessible,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandX,
  IconLeaf,
  IconTrain,
} from "@tabler/icons-react";
import { motion } from "framer-motion";

const socialIcons = [
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
];

const footerLinks = [
  {
    title: "Travel",
    links: ["Book", "Routes", "Schedules", "Stations"],
  },
  {
    title: "Support",
    links: ["Help Centre", "Accessibility", "Lost & Found", "Contact"],
  },
  {
    title: "About",
    links: ["Our Mission", "Sustainability", "Careers", "Press"],
  },
];

export const Footer = () => {
  return (
    <Box bg="dark.9" py={60}>
      <Container size="lg">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing={40}>
          {/* Brand */}
          <Stack gap="md">
            <Group gap="xs">
              <IconTrain size={24} color="white" />
              <Text size="lg" fw={700} c="white">
                Vectura
              </Text>
            </Group>
            <Text size="sm" c="dark.2" lh={1.6}>
              Canada's high-speed rail network. A Government of Canada
              initiative connecting communities sustainably.
            </Text>
            <Group gap="xs">
              {socialIcons.map((Icon, i) => (
                <motion.div key={i} whileHover={{ scale: 1.1 }}>
                  <Flex
                    w={36}
                    h={36}
                    align="center"
                    justify="center"
                    bg="dark.7"
                    style={{ borderRadius: 8, cursor: "pointer" }}
                  >
                    <Icon size={18} color="white" />
                  </Flex>
                </motion.div>
              ))}
            </Group>
          </Stack>

          {/* Links */}
          {footerLinks.map((section) => (
            <Stack key={section.title} gap="md">
              <Text size="sm" fw={600} c="white">
                {section.title}
              </Text>
              <Stack gap="xs">
                {section.links.map((link) => (
                  <Text
                    key={link}
                    size="sm"
                    c="dark.2"
                    style={{ cursor: "pointer" }}
                  >
                    {link}
                  </Text>
                ))}
              </Stack>
            </Stack>
          ))}
        </SimpleGrid>

        <Divider my={40} color="dark.6" />

        <Group justify="space-between">
          <Text size="xs" c="dark.3">
            © 2024 Vectura Canada Inc. All rights reserved.
          </Text>
          <Group gap="xl">
            <Group gap={4}>
              <IconAccessible size={14} color="var(--mantine-color-dark-3)" />
              <Text size="xs" c="dark.3">
                AODA Compliant
              </Text>
            </Group>
            <Group gap={4}>
              <IconLeaf size={14} color="var(--mantine-color-dark-3)" />
              <Text size="xs" c="dark.3">
                Carbon Neutral
              </Text>
            </Group>
          </Group>
        </Group>
      </Container>
    </Box>
  );
};
