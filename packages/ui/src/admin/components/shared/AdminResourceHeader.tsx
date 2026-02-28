import { ActionButton } from "@alepha/ui";
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Flex,
  Menu,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronLeft,
  IconExternalLink,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import AdminResourceHeaderMenuItem from "./AdminResourceHeaderMenuItem.tsx";

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
    <Flex direction="column" gap="xs">
      {/* Breadcrumb / Back navigation */}
      {backHref && (
        <Flex>
          <ActionButton
            variant="subtle"
            size="xs"
            href={backHref}
            leftSection={<IconChevronLeft size={14} />}
            c="dimmed"
          >
            {backLabel}
          </ActionButton>
        </Flex>
      )}

      {/* Main header */}
      <Flex justify="space-between" align="flex-start" wrap="nowrap">
        {/* Left: Avatar + Info */}
        <Flex gap="md" wrap="nowrap">
          {renderAvatar()}

          <Flex
            direction="column"
            gap={2}
            justify="center"
            style={{ minHeight: 56 }}
          >
            {/* Title row */}
            <Flex gap="xs" align="center">
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
            </Flex>

            {/* Subtitle */}
            {subtitle && (
              <Text size="xs" c="dimmed">
                {subtitle}
              </Text>
            )}
          </Flex>
        </Flex>

        {/* Right: Actions */}
        <Flex gap="xs">
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
                  <AdminResourceHeaderMenuItem key={index} action={action} />
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
};

export default AdminResourceHeader;
