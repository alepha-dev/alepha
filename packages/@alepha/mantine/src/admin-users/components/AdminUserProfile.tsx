import { ClipboardButton, Flex, Text } from "@alepha/mantine";
import { Badge, Grid, Paper, RingProgress, ThemeIcon } from "@mantine/core";
import {
  IconAt,
  IconCalendar,
  IconClock,
  IconFingerprint,
  IconMail,
  IconMailCheck,
  IconMailX,
  IconPhone,
  IconShield,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { adminUserAtom } from "../atoms/adminUserAtom.ts";

const AdminUserProfile = () => {
  const [user] = useStore(adminUserAtom);
  const { l } = useI18n();

  if (!user) return null;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(user.createdAt).getTime()) / 86400000,
  );
  const accountAge =
    daysSinceCreation < 1
      ? "Today"
      : daysSinceCreation < 30
        ? `${daysSinceCreation}d`
        : daysSinceCreation < 365
          ? `${Math.floor(daysSinceCreation / 30)}mo`
          : `${Math.floor(daysSinceCreation / 365)}y`;

  const completeness = [
    user.email,
    user.username,
    user.firstName,
    user.lastName,
    user.phoneNumber,
    user.picture,
    user.emailVerified,
  ].filter(Boolean).length;
  const completenessPercent = Math.round((completeness / 7) * 100);

  return (
    <Flex direction="column" gap="md">
      {/* Top metrics row */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" withBorder>
            <Flex align="center" gap="md">
              <RingProgress
                size={52}
                thickness={5}
                roundCaps
                sections={[
                  {
                    value: completenessPercent,
                    color: completenessPercent === 100 ? "teal" : "blue",
                  },
                ]}
                label={
                  <Text ta="center" size="xs" fw={700}>
                    {completenessPercent}%
                  </Text>
                }
              />
              <Flex direction="column" gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Profile
                </Text>
                <Text size="sm" fw={500}>
                  {completenessPercent === 100 ? "Complete" : "Incomplete"}
                </Text>
              </Flex>
            </Flex>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" withBorder>
            <Flex align="center" gap="md">
              <ThemeIcon
                size={52}
                radius="md"
                variant="light"
                color={user.emailVerified ? "teal" : "orange"}
              >
                {user.emailVerified ? (
                  <IconMailCheck size={24} />
                ) : (
                  <IconMailX size={24} />
                )}
              </ThemeIcon>
              <Flex direction="column" gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Email
                </Text>
                <Text size="sm" fw={500}>
                  {user.emailVerified ? "Verified" : "Unverified"}
                </Text>
              </Flex>
            </Flex>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" withBorder>
            <Flex align="center" gap="md">
              <ThemeIcon size={52} radius="md" variant="light" color="gray">
                <IconCalendar size={24} />
              </ThemeIcon>
              <Flex direction="column" gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Account age
                </Text>
                <Text size="sm" fw={500}>
                  {accountAge}
                </Text>
              </Flex>
            </Flex>
          </Paper>
        </Grid.Col>
      </Grid>

      {/* Detail cards */}
      <Grid>
        {/* Identity card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper p="md" radius="md" withBorder h="100%">
            <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb="sm">
              Identity
            </Text>
            <Flex direction="column" gap="sm">
              <Field
                icon={<IconUser size={16} />}
                label="Full name"
                value={fullName}
              />
              <Field
                icon={<IconAt size={16} />}
                label="Username"
                value={user.username}
                mono
              />
              <Field
                icon={<IconMail size={16} />}
                label="Email"
                value={user.email}
                copyable
              />
              <Field
                icon={<IconPhone size={16} />}
                label="Phone"
                value={user.phoneNumber}
              />
              <Field
                icon={<IconFingerprint size={16} />}
                label="ID"
                value={user.id}
                mono
                copyable
                truncate
              />
            </Flex>
          </Paper>
        </Grid.Col>

        {/* Account card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper p="md" radius="md" withBorder h="100%">
            <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb="sm">
              Account
            </Text>
            <Flex direction="column" gap="sm">
              <Field
                icon={<IconWorld size={16} />}
                label="Realm"
                value={user.realm}
              />
              <Field
                icon={<IconShield size={16} />}
                label="Roles"
                value={
                  (user.roles ?? []).length > 0 ? (
                    <Flex gap={4} wrap="wrap">
                      {user.roles.map((role) => (
                        <Badge key={role} size="xs" variant="light">
                          {role}
                        </Badge>
                      ))}
                    </Flex>
                  ) : undefined
                }
              />
              <Field
                icon={<IconCalendar size={16} />}
                label="Created"
                value={String(l(user.createdAt, { date: "lll" }))}
              />
              <Field
                icon={<IconClock size={16} />}
                label="Updated"
                value={String(l(user.updatedAt, { date: "lll" }))}
              />
            </Flex>
          </Paper>
        </Grid.Col>
      </Grid>
    </Flex>
  );
};

export default AdminUserProfile;

// ----- Field component -----

interface FieldProps {
  icon: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  copyable?: boolean;
  truncate?: boolean;
}

const Field = (props: FieldProps) => {
  const empty = props.value == null || props.value === "";

  return (
    <Flex
      gap="sm"
      align="center"
      py={6}
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <ThemeIcon size={28} variant="subtle" color="gray" radius="md">
        {props.icon}
      </ThemeIcon>

      <Text size="xs" c="dimmed" miw={70} style={{ flexShrink: 0 }}>
        {props.label}
      </Text>

      <Flex flex={1} justify="flex-end" align="center" gap={4} miw={0}>
        {empty ? (
          <Text size="sm" c="dimmed">
            —
          </Text>
        ) : typeof props.value === "string" ? (
          <Text
            size="sm"
            fw={500}
            ff={props.mono ? "monospace" : undefined}
            truncate={props.truncate ? "end" : undefined}
            style={props.truncate ? { maxWidth: 180 } : undefined}
          >
            {props.value}
          </Text>
        ) : (
          props.value
        )}

        {props.copyable && !empty && typeof props.value === "string" && (
          <ClipboardButton value={props.value} size="xs" variant="subtle" />
        )}
      </Flex>
    </Flex>
  );
};
