import {
  Badge,
  Box,
  Button,
  Group,
  SegmentedControl,
  SimpleGrid,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconDownload, IconPalette } from "@tabler/icons-react";
import { useState } from "react";

const themes = [
  {
    id: 1,
    name: "Minimal",
    author: "Alepha Team",
    active: true,
    color1: "#1d1f20",
    color2: "#f5f5f5",
    description: "Clean, minimal theme perfect for technical blogs.",
    version: "2.1.0",
    installs: "12,400",
  },
  {
    id: 2,
    name: "Developer Dark",
    author: "Community",
    active: false,
    color1: "#0f172a",
    color2: "#1e293b",
    description:
      "Dark theme with syntax highlighting optimized for code-heavy posts.",
    version: "1.4.2",
    installs: "8,920",
  },
  {
    id: 3,
    name: "Magazine",
    author: "Alepha Team",
    active: false,
    color1: "#7c3aed",
    color2: "#ede9fe",
    description:
      "Magazine-style layout with featured images and multi-column design.",
    version: "3.0.1",
    installs: "15,600",
  },
  {
    id: 4,
    name: "Starter",
    author: "Alepha Team",
    active: false,
    color1: "#f6821f",
    color2: "#fff7ed",
    description:
      "The default Alepha Blog starter theme with all essential features.",
    version: "1.0.0",
    installs: "42,100",
  },
  {
    id: 5,
    name: "Photography",
    author: "Community",
    active: false,
    color1: "#1d1f20",
    color2: "#ffffff",
    description: "Full-width image galleries with minimal text overlay.",
    version: "1.2.0",
    installs: "6,300",
  },
  {
    id: 6,
    name: "Docs",
    author: "Alepha Team",
    active: false,
    color1: "#0051c3",
    color2: "#eff6ff",
    description:
      "Documentation-focused theme with sidebar navigation and search.",
    version: "2.0.0",
    installs: "19,800",
  },
  {
    id: 7,
    name: "Newsletter",
    author: "Community",
    active: false,
    color1: "#059669",
    color2: "#ecfdf5",
    description: "Email-optimized layouts for newsletter-first blogs.",
    version: "1.1.0",
    installs: "4,200",
  },
  {
    id: 8,
    name: "Portfolio",
    author: "Community",
    active: false,
    color1: "#ec4899",
    color2: "#fdf2f8",
    description: "Showcase your projects and case studies with visual flair.",
    version: "1.3.1",
    installs: "7,800",
  },
];

const Themes = () => {
  const [tab, setTab] = useState("installed");

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Themes
        </Title>
        <Button
          variant="outline"
          color="gray"
          size="sm"
          leftSection={<IconDownload size={14} />}
          onClick={() =>
            notifications.show({
              title: "Browse Themes",
              message: "Opening theme marketplace...",
              color: "blue",
            })
          }
        >
          Install Theme
        </Button>
      </Group>

      {/* Tabs */}
      <SegmentedControl
        size="xs"
        value={tab}
        onChange={setTab}
        mb="xl"
        data={[
          { value: "installed", label: "Installed (8)" },
          { value: "browse", label: "Browse Themes" },
          { value: "updates", label: "Updates (1)" },
        ]}
      />

      {/* Theme grid */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {themes.map((theme) => (
          <Box key={theme.id} className="cf-theme-card">
            {/* Preview */}
            <Box
              className="cf-theme-preview"
              style={{
                background: `linear-gradient(135deg, ${theme.color1} 0%, ${theme.color2} 100%)`,
                position: "relative",
              }}
            >
              {theme.active && (
                <Badge
                  color="teal"
                  variant="filled"
                  size="sm"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                  }}
                  leftSection={<IconCheck size={12} />}
                >
                  Active
                </Badge>
              )}
              <IconPalette size={40} color="rgba(255,255,255,0.5)" />
            </Box>

            {/* Info */}
            <Box p="sm">
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={600}>
                  {theme.name}
                </Text>
                <Text size="xs" c="dimmed">
                  v{theme.version}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">
                by {theme.author}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={2} mb="sm">
                {theme.description}
              </Text>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {theme.installs} installs
                </Text>
                {theme.active ? (
                  <Button
                    variant="outline"
                    color="gray"
                    size="xs"
                    onClick={() =>
                      notifications.show({
                        title: "Customize",
                        message: "Opening theme customizer...",
                        color: "blue",
                      })
                    }
                  >
                    Customize
                  </Button>
                ) : (
                  <Button
                    variant="light"
                    color="orange"
                    size="xs"
                    onClick={() =>
                      notifications.show({
                        title: "Theme Activated",
                        message: `Theme "${theme.name}" has been activated.`,
                        color: "teal",
                      })
                    }
                  >
                    Activate
                  </Button>
                )}
              </Group>
            </Box>
          </Box>
        ))}
      </SimpleGrid>
    </Box>
  );
};

export default Themes;
