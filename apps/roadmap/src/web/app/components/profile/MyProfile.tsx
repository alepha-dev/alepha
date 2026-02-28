import { ActionButton, Flex, Text, useToast } from "@alepha/ui";
import { Avatar, Badge, Card, Grid, Title } from "@mantine/core";
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
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import { type ChangeEvent, useRef, useState } from "react";
import type { UserController } from "@/api/controllers/UserController.ts";
import type { User } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";

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
  const [, setUser] = useStore(currentUserAtom); // to trigger re-render on avatar update
  const characterInfo = useInject(CharacterInfo);
  const userApi = useClient<UserController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
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
      toast.success({ message: "Avatar updated successfully" });
    } catch (error) {
      toast.danger({
        message: (error as Error)?.message || "Failed to update avatar",
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
    <Flex bg={"var(--alepha-ground)"} flex={1} p="lg">
      <Flex direction="column" w="100%" maw={1000}>
        {/* Header Card */}
        <Card shadow="sm" padding="xl" radius="md" withBorder>
          <Flex gap="xl" align="flex-start">
            <Flex direction="column" gap="xs" align="center">
              <Avatar
                src={
                  currentUser.picture
                    ? `/api/files/${currentUser.picture}`
                    : undefined
                }
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
              <ActionButton
                size="xs"
                variant="light"
                leftSection={<IconCamera size={16} />}
                onClick={handleAvatarClick}
                loading={uploading}
              >
                {uploading ? "Uploading..." : "Change Avatar"}
              </ActionButton>
            </Flex>

            <Flex direction="column" gap="md" flex={1}>
              <Flex direction="column" gap="xs">
                <Title order={2}>{user.username || "Anonymous User"}</Title>
                <Flex gap="sm">
                  <IconMail size={16} />
                  <Text c="dimmed">{user.email}</Text>
                </Flex>
                <Flex gap="sm">
                  <IconCalendar size={16} />
                  <Text c="dimmed">Member since {l(user.createdAt)}</Text>
                </Flex>
              </Flex>

              <Flex gap="sm">
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
              </Flex>
            </Flex>
          </Flex>
        </Card>

        <Grid>
          {/* Gaming Statistics */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
              <Flex direction="column" gap="md">
                <Flex gap="sm">
                  <IconTrophy size={20} />
                  <Title order={4}>Gaming Statistics</Title>
                </Flex>

                <Flex direction="column" gap="sm">
                  <Flex justify="space-between">
                    <Text size="sm" fw={500}>
                      Total Experience
                    </Text>
                    <Text size="sm" fw={600}>
                      {l(totalXP)} XP
                    </Text>
                  </Flex>

                  <Flex justify="space-between">
                    <Text size="sm" fw={500}>
                      Total Gold
                    </Text>
                    <Text size="sm" c="yellow.6" fw={600}>
                      {l(totalGold)}g
                    </Text>
                  </Flex>

                  <Flex justify="space-between">
                    <Text size="sm" fw={500}>
                      Active Characters
                    </Text>
                    <Text size="sm" fw={600}>
                      {characters.length}
                    </Text>
                  </Flex>

                  <Flex justify="space-between">
                    <Text size="sm" fw={500}>
                      Highest Level
                    </Text>
                    <Badge variant="light">Level {highestLevel}</Badge>
                  </Flex>

                  {characters.length > 1 && (
                    <Flex justify="space-between">
                      <Text size="sm" fw={500}>
                        Average Level
                      </Text>
                      <Badge variant="light">Level {averageLevel}</Badge>
                    </Flex>
                  )}
                </Flex>
              </Flex>
            </Card>
          </Grid.Col>

          {/* Account Security */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
              <Flex direction="column" gap="md">
                <Flex gap="sm">
                  <IconShield size={20} />
                  <Title order={4}>Account Security</Title>
                </Flex>

                <Flex direction="column" gap="sm">
                  <Flex justify="space-between">
                    <Text size="sm" fw={500}>
                      Connected Providers
                    </Text>
                    <Text size="sm" fw={600}>
                      {identities.length}
                    </Text>
                  </Flex>

                  <Flex direction="column" gap="xs">
                    {identities.map((identity) => (
                      <Flex key={identity.id} justify="space-between">
                        <Flex gap="xs">
                          {getProviderIcon(identity.provider)}
                          <Text size="sm">
                            {identity.provider === "usernamePassword"
                              ? "Password"
                              : identity.provider.charAt(0).toUpperCase() +
                                identity.provider.slice(1)}
                          </Text>
                        </Flex>
                        <Badge variant="light" size="xs">
                          Active
                        </Badge>
                      </Flex>
                    ))}
                  </Flex>

                  <Text size="xs" c="dimmed" mt="xs">
                    Last updated: {l(user.updatedAt)}
                  </Text>
                </Flex>
              </Flex>
            </Card>
          </Grid.Col>
        </Grid>
      </Flex>
    </Flex>
  );
};

export default MyProfile;
