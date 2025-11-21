import { useClient, useInject, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconCalendar,
  IconCamera,
  IconKey,
  IconMail,
  IconShield,
  IconTrophy,
  IconUser,
} from "@tabler/icons-react";
import { type ChangeEvent, useRef, useState } from "react";
import type { UserApi } from "../../api/UserApi.ts";
import type { User } from "../../entities/users.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";

export interface ProfileProps {
  user: User;
  characters: Array<{
    id: number;
    projectId: number;
    projectTitle: string;
    xp: number;
    balance: number;
    owner?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  identities: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

const MyProfile = (props: ProfileProps) => {
  const { user, characters, identities } = props;
  const [, setUser] = useStore("alepha.server.request.user"); // to trigger re-render on avatar update
  const characterInfo = useInject(CharacterInfo);
  const userApi = useClient<UserApi>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);
  const { l } = useI18n();

  // Calculate user statistics
  const totalXP = characters.reduce((sum, char) => sum + char.xp, 0);
  const totalGold = characters.reduce(
    (sum, char) => sum + characterInfo.getGold(char.balance),
    0,
  );
  const averageLevel =
    characters.length > 0
      ? Math.floor(
          characters.reduce(
            (sum, char) => sum + characterInfo.getLevelByXp(char.xp),
            0,
          ) / characters.length,
        )
      : 0;
  const highestLevel =
    characters.length > 0
      ? Math.max(
          ...characters.map((char) => characterInfo.getLevelByXp(char.xp)),
        )
      : 0;

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "google":
        return <IconBrandGoogle size={16} />;
      case "github":
        return <IconBrandGithub size={16} />;
      case "usernamePassword":
        return <IconKey size={16} />;
      default:
        return <IconUser size={16} />;
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const updatedUser = await userApi.updateAvatar({
        body: { file },
      });
      setCurrentUser(updatedUser);
      setUser({
        ...user,
        picture: updatedUser.picture,
      });
      notifications.show({
        title: "Success",
        message: "Avatar updated successfully",
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Upload Failed",
        message: (error as Error)?.message || "Failed to update avatar",
        color: "red",
      });
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <Flex bg={"var(--alepha-background)"} flex={1} p="lg">
      <Stack w="100%" maw={1000}>
        {/* Header Card */}
        <Card shadow="sm" padding="xl" radius="md" withBorder>
          <Group gap="xl" align="flex-start">
            <Stack gap="xs" align="center">
              <Avatar
                src={`/api/users/files/${currentUser.picture}`}
                size={120}
                radius="md"
              >
                <IconUser size={60} />
              </Avatar>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: "none" }}
              />
              <Button
                size="xs"
                variant="light"
                leftSection={<IconCamera size={16} />}
                onClick={handleAvatarClick}
                loading={uploading}
              >
                {uploading ? "Uploading..." : "Change Avatar"}
              </Button>
            </Stack>

            <Stack gap="md" flex={1}>
              <Stack gap="xs">
                <Title order={2}>{user.name || "Anonymous User"}</Title>
                <Group gap="sm">
                  <IconMail size={16} />
                  <Text c="dimmed">{user.email}</Text>
                </Group>
                <Group gap="sm">
                  <IconCalendar size={16} />
                  <Text c="dimmed">Member since {l(user.createdAt)}</Text>
                </Group>
              </Stack>

              <Group gap="sm">
                {user.roles.map((role) => (
                  <Badge
                    key={role}
                    variant="light"
                    color={role === "admin" ? "red" : "blue"}
                    leftSection={<IconShield size={12} />}
                  >
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </Badge>
                ))}
              </Group>
            </Stack>
          </Group>
        </Card>

        <Grid>
          {/* Gaming Statistics */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
              <Stack gap="md">
                <Group gap="sm">
                  <IconTrophy size={20} />
                  <Title order={4}>Gaming Statistics</Title>
                </Group>

                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      Total Experience
                    </Text>
                    <Text size="sm" fw={600}>
                      {l(totalXP)} XP
                    </Text>
                  </Group>

                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      Total Gold
                    </Text>
                    <Text size="sm" c="yellow.6" fw={600}>
                      {l(totalGold)}g
                    </Text>
                  </Group>

                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      Active Characters
                    </Text>
                    <Text size="sm" fw={600}>
                      {characters.length}
                    </Text>
                  </Group>

                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      Highest Level
                    </Text>
                    <Badge variant="light">Level {highestLevel}</Badge>
                  </Group>

                  {characters.length > 1 && (
                    <Group justify="space-between">
                      <Text size="sm" fw={500}>
                        Average Level
                      </Text>
                      <Badge variant="light">Level {averageLevel}</Badge>
                    </Group>
                  )}
                </Stack>
              </Stack>
            </Card>
          </Grid.Col>

          {/* Account Security */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
              <Stack gap="md">
                <Group gap="sm">
                  <IconShield size={20} />
                  <Title order={4}>Account Security</Title>
                </Group>

                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      Connected Providers
                    </Text>
                    <Text size="sm" fw={600}>
                      {identities.length}
                    </Text>
                  </Group>

                  <Stack gap="xs">
                    {identities.map((identity) => (
                      <Group key={identity.id} justify="space-between">
                        <Group gap="xs">
                          {getProviderIcon(identity.provider)}
                          <Text size="sm">
                            {identity.provider === "usernamePassword"
                              ? "Password"
                              : identity.provider.charAt(0).toUpperCase() +
                                identity.provider.slice(1)}
                          </Text>
                        </Group>
                        <Badge variant="light" size="xs">
                          Active
                        </Badge>
                      </Group>
                    ))}
                  </Stack>

                  <Text size="xs" c="dimmed" mt="xs">
                    Last updated: {l(user.updatedAt)}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </Stack>
    </Flex>
  );
};

export default MyProfile;
