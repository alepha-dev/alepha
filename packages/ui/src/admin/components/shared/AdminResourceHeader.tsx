import { ActionButton } from "@alepha/ui";
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronLeft,
  IconExternalLink,
} from "@tabler/icons-react";
import { useRouter } from "alepha/react/router";
import type { ComponentType, ReactNode } from "react";

export interface AdminResourceAction {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onClick?: () => void;
  href?: string;
  color?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: "filled" | "light" | "outline" | "subtle";
}

export interface AdminResourceHeaderProps {
  /**
   * Back navigation URL
   */
  backHref?: string;

  /**
   * Back navigation label
   */
  backLabel?: string;

  /**
   * Avatar content (letter, image URL, or custom node)
   */
  avatar?: string | ReactNode;

  /**
   * Avatar color
   */
  avatarColor?: string;

  /**
   * Resource title (e.g., user name)
   */
  title: string;

  /**
   * Secondary text (e.g., email)
   */
  subtitle?: string;

  /**
   * Tertiary identifier to copy (e.g., user ID)
   */
  identifier?: string;

  /**
   * Label for the identifier tooltip
   */
  identifierLabel?: string;

  /**
   * Status badge
   */
  status?: {
    label: string;
    color: "green" | "red" | "yellow" | "blue" | "gray";
  };

  /**
   * Additional badges (e.g., roles)
   */
  badges?: Array<{
    label: string;
    color?: string;
    variant?: "filled" | "light" | "outline" | "dot";
  }>;

  /**
   * Primary action button
   */
  primaryAction?: AdminResourceAction;

  /**
   * Menu actions (shown in dropdown)
   */
  menuActions?: AdminResourceAction[];

  /**
   * External link URL
   */
  externalUrl?: string;

  /**
   * Loading state
   */
  loading?: boolean;
}

const ActionMenuItem = (props: { action: AdminResourceAction }) => {
  const { action } = props;
  const router = useRouter();

  const menuItemProps: Record<string, unknown> = {};
  if (action.href) {
    Object.assign(menuItemProps, router.anchor(action.href));
  } else if (action.onClick) {
    menuItemProps.onClick = action.onClick;
  }

  return (
    <Menu.Item
      leftSection={action.icon ? <action.icon size={16} /> : undefined}
      color={action.color}
      disabled={action.disabled}
      {...menuItemProps}
    >
      {action.label}
    </Menu.Item>
  );
};

const AdminResourceHeader = (props: AdminResourceHeaderProps) => {
  const {
    backHref,
    backLabel = "Back",
    avatar,
    avatarColor = "blue",
    title,
    subtitle,
    identifier,
    identifierLabel = "ID",
    status,
    badges = [],
    primaryAction,
    menuActions = [],
    externalUrl,
  } = props;

  const renderAvatar = () => {
    if (typeof avatar === "string") {
      if (avatar.startsWith("http") || avatar.startsWith("/")) {
        return (
          <Avatar src={avatar} size={56} radius="md" color={avatarColor} />
        );
      }
      return (
        <Avatar size={56} radius="md" color={avatarColor}>
          {avatar}
        </Avatar>
      );
    }
    if (avatar) {
      return avatar;
    }
    return (
      <Avatar size={56} radius="md" color={avatarColor}>
        {title.charAt(0).toUpperCase()}
      </Avatar>
    );
  };

  return (
    <Stack gap="xs">
      {/* Breadcrumb / Back navigation */}
      {backHref && (
        <Group>
          <ActionButton
            variant="subtle"
            size="xs"
            href={backHref}
            leftSection={<IconChevronLeft size={14} />}
            c="dimmed"
          >
            {backLabel}
          </ActionButton>
        </Group>
      )}

      {/* Main header */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        {/* Left: Avatar + Info */}
        <Group gap="md" wrap="nowrap">
          {renderAvatar()}

          <Stack gap={2} justify="center" style={{ minHeight: 56 }}>
            {/* Title row */}
            <Group gap="xs" align="center">
              <Text size="md" fw={600} lh={1.2}>
                {title}
              </Text>
              {status && (
                <Badge
                  size="xs"
                  variant="light"
                  color={status.color}
                  tt="lowercase"
                >
                  {status.label}
                </Badge>
              )}
            </Group>

            {/* Subtitle */}
            {subtitle && (
              <Text size="xs" c="dimmed">
                {subtitle}
              </Text>
            )}
          </Stack>
        </Group>

        {/* Right: Actions */}
        <Group gap="xs">
          {externalUrl && (
            <Tooltip label="Open in new tab" openDelay={500}>
              <ActionIcon
                variant="subtle"
                color="gray"
                component="a"
                href={externalUrl}
                target="_blank"
              >
                <IconExternalLink size={18} />
              </ActionIcon>
            </Tooltip>
          )}

          {primaryAction && (
            <ActionButton
              variant={primaryAction.variant ?? "light"}
              color={primaryAction.color}
              onClick={primaryAction.onClick}
              href={primaryAction.href}
              loading={primaryAction.loading}
              disabled={primaryAction.disabled}
              leftSection={
                primaryAction.icon ? (
                  <primaryAction.icon size={16} />
                ) : undefined
              }
            >
              {primaryAction.label}
            </ActionButton>
          )}

          {menuActions.length > 0 && (
            <Menu position="bottom-end" shadow="md" width={220}>
              <Menu.Target>
                <Button
                  variant="default"
                  rightSection={<IconChevronDown size={16} />}
                >
                  Actions
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {menuActions.map((action, index) => (
                  <ActionMenuItem key={index} action={action} />
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
    </Stack>
  );
};

export default AdminResourceHeader;
