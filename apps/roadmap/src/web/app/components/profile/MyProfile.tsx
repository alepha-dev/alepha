import { Flex, Text, useToast } from "@alepha/ui";
import {
  Avatar,
  Badge,
  Divider,
  Progress,
  RingProgress,
  Tooltip,
} from "@mantine/core";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconCamera,
  IconCoin,
  IconFlame,
  IconKey,
  IconShieldCheck,
  IconStar,
  IconSwords,
  IconUser,
} from "@tabler/icons-react";
import { useClient, useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
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
  const [, setUser] = useStore(currentUserAtom);
  const auth = useAuth();
  const characterInfo = useInject(CharacterInfo);
  const userApi = useClient<UserController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);
  const { l } = useI18n();

  const totalXP = characters.reduce((sum, char) => sum + char.xp, 0);
  const totalGold = characters.reduce(
    (sum, char) => sum + characterInfo.getGold(char.balance),
    0,
  );
  const totalSilver = characters.reduce(
    (sum, char) => sum + characterInfo.getSilver(char.balance),
    0,
  );
  const highestLevel =
    characters.length > 0
      ? Math.max(
          ...characters.map((char) => characterInfo.getLevelByXp(char.xp)),
        )
      : 0;

  const xpProgress =
    highestLevel > 0 && characters.length > 0
      ? (() => {
          const best = characters.reduce((a, b) => (a.xp > b.xp ? a : b));
          const level = characterInfo.getLevelByXp(best.xp);
          const maxXp = characterInfo.getMaxXpForLevel(level);
          const currentXp = characterInfo.getCurrentXpForLevel(level, best.xp);
          return Math.round((currentXp / maxXp) * 100);
        })()
      : 0;

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const updatedUser = await userApi.updateAvatar({ body: { file } });
      setCurrentUser(updatedUser);
      await auth.refresh();
      toast.success({ message: "Avatar updated successfully" });
    } catch (error) {
      toast.danger({
        message: (error as Error)?.message || "Failed to update avatar",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const providerIcon = (provider: string) => {
    const size = 14;
    if (provider === "google") return <IconBrandGoogle size={size} />;
    if (provider === "github") return <IconBrandGithub size={size} />;
    if (provider === "usernamePassword") return <IconKey size={size} />;
    return <IconUser size={size} />;
  };

  const providerLabel = (provider: string) => {
    if (provider === "usernamePassword") return "Password";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  };

  return (
    <Flex direction="column" gap="lg" flex={1} py="md">
      {/* Hero — Avatar + Identity */}
      <Flex
        gap="xl"
        align="center"
        p="xl"
        bg="var(--alepha-elevated)"
        style={{
          borderRadius: "var(--mantine-radius-lg)",
          border: "1px solid var(--alepha-border)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Flex direction="column" align="center" gap="xs" style={{ zIndex: 1 }}>
          <Flex
            style={{ position: "relative", cursor: "pointer" }}
            onClick={handleAvatarClick}
          >
            <Avatar
              src={
                currentUser.picture
                  ? `/api/files/${currentUser.picture}`
                  : undefined
              }
              size={100}
              radius="xl"
              style={{
                border: "3px solid var(--alepha-border)",
              }}
            >
              <IconUser size={48} />
            </Avatar>
            <Flex
              align="center"
              justify="center"
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--alepha-surface)",
                border: "2px solid var(--alepha-border)",
              }}
            >
              <IconCamera size={14} />
            </Flex>
          </Flex>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: "none" }}
          />
          {uploading && (
            <Text size="xs" c="dimmed">
              Uploading...
            </Text>
          )}
        </Flex>

        <Flex direction="column" gap={4} style={{ zIndex: 1 }} flex={1}>
          <Flex align="center" gap="sm">
            <Text size="xl" fw={700} lh={1.2}>
              {user.username || "Anonymous"}
            </Text>
            {highestLevel > 0 && (
              <Badge
                variant="light"
                color="yellow"
                size="sm"
                leftSection={<IconStar size={10} />}
              >
                Lv. {highestLevel}
              </Badge>
            )}
          </Flex>

          <Text size="sm" c="dimmed">
            {user.email}
          </Text>

          <Flex gap="xs" mt={4}>
            {user.roles.map((role: string) => (
              <Badge
                key={role}
                variant="dot"
                color={role === "admin" ? "red" : "blue"}
                size="xs"
              >
                {role}
              </Badge>
            ))}
          </Flex>

          <Text size="xs" c="dimmed" mt={2}>
            Adventurer since {l(user.createdAt, { date: "LL" })}
          </Text>
        </Flex>

        {/* XP Ring */}
        {highestLevel > 0 && (
          <Flex direction="column" align="center" gap={2}>
            <RingProgress
              size={80}
              thickness={6}
              roundCaps
              sections={[{ value: xpProgress, color: "blue" }]}
              label={
                <Flex align="center" justify="center">
                  <Text size="xs" fw={700} ta="center">
                    {xpProgress}%
                  </Text>
                </Flex>
              }
            />
            <Text size="xs" c="dimmed">
              Next level
            </Text>
          </Flex>
        )}
      </Flex>

      {/* Stats Row */}
      <Flex gap="md">
        <StatCard
          icon={<IconFlame size={18} color="var(--mantine-color-orange-5)" />}
          label="Experience"
          value={`${l(totalXP)} XP`}
        />
        <StatCard
          icon={<IconCoin size={18} color="var(--mantine-color-yellow-5)" />}
          label="Treasury"
          value={
            <Flex gap={6} align="baseline">
              <Text size="lg" fw={700} c="yellow.5">
                {l(totalGold)}
              </Text>
              <Text size="xs" c="yellow.5">
                gold
              </Text>
              <Text size="sm" fw={600} c="dimmed">
                {totalSilver}
              </Text>
              <Text size="xs" c="dimmed">
                silver
              </Text>
            </Flex>
          }
        />
        <StatCard
          icon={<IconSwords size={18} color="var(--mantine-color-teal-5)" />}
          label="Characters"
          value={String(characters.length)}
        />
      </Flex>

      {/* Characters + Security */}
      <Flex gap="md" direction={{ base: "column", md: "row" }}>
        {/* Active Characters */}
        <Flex
          direction="column"
          gap="sm"
          flex={1}
          p="lg"
          bg="var(--alepha-elevated)"
          style={{
            borderRadius: "var(--mantine-radius-md)",
            border: "1px solid var(--alepha-border)",
          }}
        >
          <Flex align="center" gap="xs">
            <IconSwords size={16} />
            <Text size="sm" fw={600}>
              Active Characters
            </Text>
          </Flex>

          {characters.length === 0 && (
            <Text size="sm" c="dimmed">
              No characters yet. Join a campaign to begin your adventure.
            </Text>
          )}

          <Flex direction="column" gap="xs">
            {characters.slice(0, 5).map((char) => {
              const level = characterInfo.getLevelByXp(char.xp);
              const maxXp = characterInfo.getMaxXpForLevel(level);
              const currentXp = characterInfo.getCurrentXpForLevel(
                level,
                char.xp,
              );
              const progress = Math.round((currentXp / maxXp) * 100);
              const gold = characterInfo.getGold(char.balance);
              const silver = characterInfo.getSilver(char.balance);

              return (
                <Flex
                  key={char.id}
                  align="center"
                  gap="sm"
                  p="xs"
                  px="sm"
                  bg="var(--alepha-surface)"
                  style={{
                    borderRadius: "var(--mantine-radius-sm)",
                    border: "1px solid var(--alepha-border)",
                  }}
                >
                  <Flex direction="column" flex={1} gap={2}>
                    <Flex align="center" justify="space-between">
                      <Flex align="center" gap="xs">
                        <Text size="sm" fw={600}>
                          {char.projectTitle}
                        </Text>
                        {char.owner && (
                          <Badge variant="light" size="xs" color="orange">
                            Owner
                          </Badge>
                        )}
                      </Flex>
                      <Flex align="center" gap={6}>
                        <Tooltip label={`${gold}g ${silver}s`}>
                          <Flex align="center" gap={2}>
                            <IconCoin
                              size={12}
                              color="var(--mantine-color-yellow-5)"
                            />
                            <Text size="xs" c="yellow.5" fw={600}>
                              {gold}
                            </Text>
                          </Flex>
                        </Tooltip>
                        <Badge variant="light" size="xs">
                          Lv. {level}
                        </Badge>
                      </Flex>
                    </Flex>
                    <Progress
                      value={progress}
                      size="xs"
                      radius="xl"
                      color="blue"
                    />
                  </Flex>
                </Flex>
              );
            })}
          </Flex>

          {characters.length > 5 && (
            <Text size="xs" c="dimmed" ta="center">
              +{characters.length - 5} more characters
            </Text>
          )}
        </Flex>

        {/* Security */}
        <Flex
          direction="column"
          gap="sm"
          w={{ base: "100%", md: 280 }}
          miw={{ md: 280 }}
          p="lg"
          bg="var(--alepha-elevated)"
          style={{
            borderRadius: "var(--mantine-radius-md)",
            border: "1px solid var(--alepha-border)",
          }}
        >
          <Flex align="center" gap="xs">
            <IconShieldCheck size={16} />
            <Text size="sm" fw={600}>
              Security
            </Text>
          </Flex>

          <Flex direction="column" gap="xs">
            {identities.map((identity) => (
              <Flex
                key={identity.id}
                align="center"
                gap="sm"
                p="xs"
                px="sm"
                bg="var(--alepha-surface)"
                style={{
                  borderRadius: "var(--mantine-radius-sm)",
                  border: "1px solid var(--alepha-border)",
                }}
              >
                {providerIcon(identity.provider)}
                <Text size="sm" flex={1}>
                  {providerLabel(identity.provider)}
                </Text>
                <Flex
                  w={8}
                  h={8}
                  style={{
                    borderRadius: "50%",
                    background: "var(--mantine-color-green-6)",
                  }}
                />
              </Flex>
            ))}
          </Flex>

          <Divider color="var(--alepha-border)" my={4} />

          <Flex justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              Last activity
            </Text>
            <Text size="xs" c="dimmed">
              {l(user.updatedAt, { date: "ll" })}
            </Text>
          </Flex>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default MyProfile;

// ---------------------------------------------------------

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}

const StatCard = (props: StatCardProps) => {
  return (
    <Flex
      direction="column"
      gap={4}
      flex={1}
      p="md"
      bg="var(--alepha-elevated)"
      style={{
        borderRadius: "var(--mantine-radius-md)",
        border: "1px solid var(--alepha-border)",
      }}
    >
      <Flex align="center" gap="xs">
        {props.icon}
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1}>
          {props.label}
        </Text>
      </Flex>
      {typeof props.value === "string" ? (
        <Text size="lg" fw={700}>
          {props.value}
        </Text>
      ) : (
        props.value
      )}
    </Flex>
  );
};
