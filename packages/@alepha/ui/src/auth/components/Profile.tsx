import { ActionButton } from "@alepha/ui";
import { Avatar, Badge, Card, Flex, Text, Title } from "@mantine/core";
import {
  IconAt,
  IconCalendar,
  IconId,
  IconShield,
  IconUser,
} from "@tabler/icons-react";
import { useAuth } from "alepha/react/auth";
import { useRouter } from "alepha/react/router";
import type { AuthRouter } from "../AuthRouter.ts";
import ProfileField from "./ProfileField.tsx";

const Profile = () => {
  const auth = useAuth();
  const router = useRouter<AuthRouter>();

  if (!auth.user) {
    return null;
  }

  const { id, name, email, username, picture, roles, organization } = auth.user;

  const displayName = name || username || email || "User";

  return (
    <Flex flex={1} justify="center" align="center">
      <Flex direction="column" gap="md" w={400}>
        <Card withBorder p="xl" bg="var(--alepha-elevated)">
          <Flex direction="column" gap="lg">
            {/* Avatar and name */}
            <Flex direction="column" align="center" gap="md">
              <Avatar
                src={picture ? `/api/files/${picture}` : undefined}
                size={96}
                radius="xl"
                color="blue"
              >
                {!picture && <IconUser size={48} />}
              </Avatar>
              <Flex direction="column" gap={4} align="center">
                <Title order={3}>{displayName}</Title>
                {email && username && (
                  <Text size="sm" c="dimmed">
                    @{username}
                  </Text>
                )}
              </Flex>
            </Flex>

            {/* User details */}
            <Flex direction="column" gap="sm">
              {email && (
                <ProfileField icon={<IconAt size={18} />} label="Email">
                  {email}
                </ProfileField>
              )}

              {username && (
                <ProfileField icon={<IconUser size={18} />} label="Username">
                  {username}
                </ProfileField>
              )}

              {id && (
                <ProfileField icon={<IconId size={18} />} label="User ID">
                  <Text size="xs" c="dimmed" ff="monospace">
                    {id}
                  </Text>
                </ProfileField>
              )}

              {/* Roles */}
              {roles && roles.length > 0 && (
                <ProfileField icon={<IconShield size={18} />} label="Roles">
                  <Flex gap="xs">
                    {roles.map((role) => (
                      <Badge key={role} size="sm" variant="light">
                        {role}
                      </Badge>
                    ))}
                  </Flex>
                </ProfileField>
              )}

              {/* Organization */}
              {organization && (
                <ProfileField
                  icon={<IconCalendar size={18} />}
                  label="Organization"
                >
                  <Badge size="sm" variant="outline">
                    {organization}
                  </Badge>
                </ProfileField>
              )}
            </Flex>

            {/* Actions */}
            <Flex direction="column" gap="sm" mt="md">
              <ActionButton
                variant="light"
                color="red"
                onClick={() => auth.logout()}
                fullWidth
              >
                Sign out
              </ActionButton>
            </Flex>
          </Flex>
        </Card>

        <ActionButton variant="subtle" href="/">
          Back to home
        </ActionButton>
      </Flex>
    </Flex>
  );
};

export default Profile;
