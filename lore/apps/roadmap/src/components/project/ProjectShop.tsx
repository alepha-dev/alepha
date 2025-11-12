import { useStore } from "@alepha/react";
import {
  Badge,
  Button,
  Card,
  Flex,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconCircleFilled,
  IconFlame,
  IconShield,
  IconShoppingCart,
  IconSword,
  IconWand,
} from "@tabler/icons-react";

interface ShopItem {
  id: string;
  name: string;
  description: string;
  price: {
    gold: number;
    silver: number;
  };
  category: "tools" | "buffs" | "cosmetics" | "utilities";
  icon: React.ReactNode;
  rarity: "common" | "rare" | "epic" | "legendary";
  effect?: string;
}

const ProjectShop = () => {
  const [character] = useStore("current_project_character");

  // Fantasy-oriented items for task management
  const shopItems: ShopItem[] = [
    {
      id: "productivity_potion",
      name: "Potion of Productivity",
      description: "Doubles XP gain from completed tasks for 24 hours",
      price: { gold: 5, silver: 0 },
      category: "buffs",
      icon: <IconFlame size={24} color="var(--mantine-color-red-6)" />,
      rarity: "epic",
      effect: "+100% XP for 24h",
    },
    {
      id: "focus_amulet",
      name: "Amulet of Focus",
      description: "Prevents task abandonment penalties for a week",
      price: { gold: 3, silver: 50 },
      category: "utilities",
      icon: <IconShield size={24} color="var(--mantine-color-blue-6)" />,
      rarity: "rare",
      effect: "No abandon penalty for 7 days",
    },
    {
      id: "task_scroll",
      name: "Scroll of Swift Creation",
      description: "Instantly create up to 3 tasks without cooldown",
      price: { gold: 2, silver: 0 },
      category: "tools",
      icon: <IconWand size={24} color="var(--mantine-color-purple-6)" />,
      rarity: "common",
      effect: "Create 3 tasks instantly",
    },
    {
      id: "complexity_crystal",
      name: "Crystal of Complexity",
      description: "Reveals the true difficulty of any task before accepting",
      price: { gold: 1, silver: 75 },
      category: "utilities",
      icon: <IconSword size={24} color="var(--mantine-color-cyan-6)" />,
      rarity: "rare",
      effect: "See task difficulty preview",
    },
    {
      id: "golden_quill",
      name: "Golden Quill of Documentation",
      description: "Automatically generates detailed task descriptions",
      price: { gold: 8, silver: 0 },
      category: "tools",
      icon: <IconWand size={24} color="var(--mantine-color-yellow-6)" />,
      rarity: "legendary",
      effect: "Auto-generate task descriptions",
    },
    {
      id: "time_hourglass",
      name: "Hourglass of Extended Deadlines",
      description: "Extends all task deadlines by 2 days",
      price: { gold: 4, silver: 25 },
      category: "utilities",
      icon: <IconShield size={24} color="var(--mantine-color-orange-6)" />,
      rarity: "epic",
      effect: "Extend all deadlines +2 days",
    },
    {
      id: "silver_badge",
      name: "Silver Badge of Recognition",
      description: "Display your achievements with this shiny badge",
      price: { gold: 0, silver: 95 },
      category: "cosmetics",
      icon: <IconShield size={24} color="var(--color-silver)" />,
      rarity: "common",
      effect: "Cosmetic profile badge",
    },
    {
      id: "team_banner",
      name: "Banner of Team Unity",
      description: "Boosts XP gain for all project members by 10%",
      price: { gold: 15, silver: 0 },
      category: "buffs",
      icon: <IconFlame size={24} color="var(--mantine-color-green-6)" />,
      rarity: "legendary",
      effect: "Team-wide +10% XP boost",
    },
    {
      id: "priority_compass",
      name: "Compass of Priority",
      description: "Automatically sorts tasks by optimal completion order",
      price: { gold: 6, silver: 50 },
      category: "tools",
      icon: <IconWand size={24} color="var(--mantine-color-indigo-6)" />,
      rarity: "epic",
      effect: "Auto-sort tasks by priority",
    },
  ];

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case "common":
        return "gray";
      case "rare":
        return "blue";
      case "epic":
        return "purple";
      case "legendary":
        return "yellow";
      default:
        return "gray";
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "tools":
        return "Tools";
      case "buffs":
        return "Buffs";
      case "cosmetics":
        return "Cosmetics";
      case "utilities":
        return "Utilities";
      default:
        return "Misc";
    }
  };

  if (!character) {
    return (
      <Flex justify="center" align="center" h="50vh">
        <Text c="dimmed">Loading shop...</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} p="lg" className={"overflow-auto"}>
      <Stack w="100%">
        <Group gap="sm" align="center">
          <IconShoppingCart size={24} />
          <Title order={2}>Mystical Market</Title>
        </Group>

        <Text c="dimmed" size="sm">
          Enhance your quest management abilities with magical items and
          potions.
        </Text>

        {/* Shop Items Grid */}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {shopItems.map((item) => (
            <Card key={item.id} withBorder p="lg" h="100%">
              <Stack h="100%">
                <Group gap="sm" align="center">
                  {item.icon}
                  <Stack gap={0} flex={1}>
                    <Text size="lg" fw={600}>
                      {item.name}
                    </Text>
                    <Group gap="xs">
                      <Badge
                        size="xs"
                        color={getRarityColor(item.rarity)}
                        variant="light"
                      >
                        {item.rarity}
                      </Badge>
                      <Badge size="xs" variant="outline">
                        {getCategoryLabel(item.category)}
                      </Badge>
                    </Group>
                  </Stack>
                </Group>

                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  {item.description}
                </Text>

                {item.effect && (
                  <Card withBorder p="xs" bg="var(--alepha-bg)">
                    <Text size="xs" fw={500} ff={"monospace"}>
                      Effect: {item.effect}
                    </Text>
                  </Card>
                )}

                <Group justify="space-between" align="center" mt="auto">
                  <Group gap="xs">
                    {item.price.gold > 0 && (
                      <Group gap={2}>
                        <Text size="sm" fw={500}>
                          {item.price.gold}
                        </Text>
                        <IconCircleFilled color="var(--color-gold)" size={14} />
                      </Group>
                    )}
                    {item.price.silver > 0 && (
                      <Group gap={2}>
                        <Text size="sm" fw={500}>
                          {item.price.silver}
                        </Text>
                        <IconCircleFilled
                          color="var(--color-silver)"
                          size={14}
                        />
                      </Group>
                    )}
                  </Group>
                  <Button
                    size="xs"
                    variant="filled"
                    disabled={
                      character.balance <
                      item.price.gold * 100 + item.price.silver
                    }
                  >
                    Purchase
                  </Button>
                </Group>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

        {/* Shop Info */}
        <Flex p="md" mt="lg">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Shop Information
            </Text>
            <Text size="xs" c="dimmed">
              • Complete tasks to earn gold and silver
            </Text>
            <Text size="xs" c="dimmed">
              • Higher complexity tasks reward more coins
            </Text>
            <Text size="xs" c="dimmed">
              • Items provide permanent or temporary benefits to your
              productivity
            </Text>
            <Text size="xs" c="dimmed">
              • Team buffs affect all project members
            </Text>
          </Stack>
        </Flex>
      </Stack>
    </Flex>
  );
};

export default ProjectShop;
