import { useRouter } from "@alepha/react";
import {
  Anchor,
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
import type { CwsRouter } from "../../../CwsRouter.ts";

const socialIcons = [
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
];

export const Footer = () => {
  const router = useRouter<CwsRouter>();

  const footerLinks = [
    {
      title: "Travel",
      links: [
        { label: "Book", onClick: () => router.go("bookingSearch") },
        { label: "Routes", onClick: () => router.go("routes") },
        { label: "Schedules", onClick: () => router.go("schedules") },
        { label: "Stations", onClick: () => router.go("stations") },
      ],
    },
    {
      title: "Support",
      links: [
        { label: "Help Centre", onClick: () => router.go("helpCentre") },
        { label: "Accessibility", onClick: () => router.go("accessibility") },
        { label: "Lost & Found", onClick: () => router.go("lostAndFound") },
        { label: "Contact", onClick: () => router.go("contact") },
      ],
    },
    {
      title: "About",
      links: [
        { label: "Our Mission", onClick: () => router.go("mission") },
        { label: "Sustainability", onClick: () => router.go("sustainability") },
        { label: "Careers", onClick: () => router.go("careers") },
        { label: "Press", onClick: () => router.go("press") },
      ],
    },
  ];

  return (
    <Box bg="dark.9" py={60}>
      <Container size="lg">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing={40}>
          {/* Brand */}
          <Stack gap="md">
            <Group gap="xs">
              <IconTrain size={24} color="white" />
              <Text size="lg" fw={700} c="white">
                AlephaRail
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
                  <Anchor
                    key={link.label}
                    size="sm"
                    c="dark.2"
                    underline="hover"
                    onClick={link.onClick}
                    style={{ cursor: "pointer" }}
                  >
                    {link.label}
                  </Anchor>
                ))}
              </Stack>
            </Stack>
          ))}
        </SimpleGrid>

        <Divider my={40} color="dark.6" />

        <Group justify="space-between">
          <Text size="xs" c="dark.3">
            &copy; 2025 AlephaRail Canada Inc. All rights reserved.
          </Text>
          <Group gap="xl">
            <Anchor
              size="xs"
              c="dark.3"
              underline="hover"
              onClick={() => router.go("accessibility")}
              style={{ cursor: "pointer" }}
            >
              <Group gap={4}>
                <IconAccessible size={14} />
                AODA Compliant
              </Group>
            </Anchor>
            <Anchor
              size="xs"
              c="dark.3"
              underline="hover"
              onClick={() => router.go("sustainability")}
              style={{ cursor: "pointer" }}
            >
              <Group gap={4}>
                <IconLeaf size={14} />
                Carbon Neutral
              </Group>
            </Anchor>
          </Group>
        </Group>
      </Container>
    </Box>
  );
};
