import { useActive } from "@alepha/react/src/hooks/useActive";
import { Box, Flex, UnstyledButton } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconSearch,
} from "@tabler/icons-react";
import { useState } from "react";

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  activeStartsWith?: boolean; // Use startWith matching for active state
  onClick?: () => void;
  children?: MenuItem[];
}

export interface SidebarProps {
  menu: MenuItem[];
  defaultOpenIds?: string[];
  onItemClick?: (item: MenuItem) => void;
  showSearchButton?: boolean;
  onSearchClick?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  menu,
  defaultOpenIds = [],
  onItemClick,
  showSearchButton = false,
  onSearchClick,
}) => {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(defaultOpenIds));

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  return (
    <Box component="nav" className="alepha-sidebar">
      {showSearchButton && (
        <UnstyledButton
          className="alepha-sidebar-search-button"
          onClick={onSearchClick}
        >
          <Box className="alepha-sidebar-search-button-content">
            <Box className="alepha-sidebar-search-button-left">
              <IconSearch size={16} />
              <span>Search...</span>
            </Box>
            <Box className="alepha-sidebar-search-button-shortcut">
              <kbd>⌘+K</kbd>
            </Box>
          </Box>
        </UnstyledButton>
      )}
      {menu.map((item) => (
        <SidebarItem
          key={item.id}
          item={item}
          level={0}
          openIds={openIds}
          onToggle={toggleOpen}
          onItemClick={onItemClick}
        />
      ))}
    </Box>
  );
};

// ---------------------------------------------------------------------------------------------------------------------
// SidebarItem - Main component that decides which variant to render
// ---------------------------------------------------------------------------------------------------------------------

export interface SidebarItemProps {
  item: MenuItem;
  level: number;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onItemClick?: (item: MenuItem) => void;
}

export const SidebarItem: React.FC<SidebarItemProps> = (props) => {
  const { item, level } = props;
  const maxLevel = 2; // 0, 1, 2 = 3 levels total

  if (level > maxLevel) return null;

  // Render different components based on whether item has href or not
  if (item.href) {
    return <SidebarItemHref {...props} />;
  }

  return <SidebarItemButton {...props} />;
};

// ---------------------------------------------------------------------------------------------------------------------
// SidebarItemHref - Component for items with href (navigation)
// ---------------------------------------------------------------------------------------------------------------------

const SidebarItemHref: React.FC<SidebarItemProps> = ({
  item,
  level,
  openIds,
  onToggle,
  onItemClick,
}) => {
  const hasChildren = item.children && item.children.length > 0;
  const isOpen = openIds.has(item.id);

  // Use the useActive hook for navigation
  const { isActive, anchorProps } = useActive({
    href: item.href!,
    startWith: item.activeStartsWith,
  });

  const handleItemClick = (e: React.MouseEvent) => {
    if (hasChildren) {
      e.preventDefault();
      onToggle(item.id);
    }
    // anchorProps.onClick handles navigation automatically
  };

  return (
    <Box className="alepha-sidebar-item-wrapper">
      <UnstyledButton
        component="a"
        {...anchorProps}
        className={`alepha-sidebar-item alepha-sidebar-level-${level} ${isActive ? "alepha-sidebar-item-active" : ""}`}
        onClick={hasChildren ? handleItemClick : anchorProps.onClick}
      >
        <Flex justify="space-between" align="center" w="100%">
          <Flex className="alepha-sidebar-item-content" align="center" gap={10}>
            <Box className="alepha-sidebar-item-icon">
              {item.icon || <IconCircle size={16} />}
            </Box>
            <Box className="alepha-sidebar-item-label">{item.label}</Box>
          </Flex>
          {hasChildren && (
            <Box className="alepha-sidebar-item-caret">
              {isOpen ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </Box>
          )}
        </Flex>
      </UnstyledButton>
      {hasChildren && isOpen && (
        <Box className="alepha-sidebar-children" data-parent-level={level}>
          {(level === 0 || level === 1) && (
            <Box className="alepha-sidebar-vertical-bar" />
          )}
          <Box className="alepha-sidebar-children-items">
            {item.children!.map((child) => (
              <SidebarItem
                key={child.id}
                item={child}
                level={level + 1}
                openIds={openIds}
                onToggle={onToggle}
                onItemClick={onItemClick}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------------------------------------------------
// SidebarItemButton - Component for items without href (buttons with onClick)
// ---------------------------------------------------------------------------------------------------------------------

const SidebarItemButton: React.FC<SidebarItemProps> = ({
  item,
  level,
  openIds,
  onToggle,
  onItemClick,
}) => {
  const hasChildren = item.children && item.children.length > 0;
  const isOpen = openIds.has(item.id);

  const handleItemClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (hasChildren) {
      onToggle(item.id);
    } else {
      onItemClick?.(item);
      item.onClick?.();
    }
  };

  return (
    <Box className="alepha-sidebar-item-wrapper">
      <UnstyledButton
        component="button"
        className={`alepha-sidebar-item alepha-sidebar-level-${level}`}
        onClick={handleItemClick}
      >
        <Flex justify="space-between" align="center" w="100%">
          <Flex className="alepha-sidebar-item-content" align="center" gap={10}>
            <Box className="alepha-sidebar-item-icon">
              {item.icon || <IconCircle size={16} />}
            </Box>
            <Box className="alepha-sidebar-item-label">{item.label}</Box>
          </Flex>
          {hasChildren && (
            <Box className="alepha-sidebar-item-caret">
              {isOpen ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </Box>
          )}
        </Flex>
      </UnstyledButton>
      {hasChildren && isOpen && (
        <Box className="alepha-sidebar-children" data-parent-level={level}>
          {(level === 0 || level === 1) && (
            <Box className="alepha-sidebar-vertical-bar" />
          )}
          <Box className="alepha-sidebar-children-items">
            {item.children!.map((child) => (
              <SidebarItem
                key={child.id}
                item={child}
                level={level + 1}
                openIds={openIds}
                onToggle={onToggle}
                onItemClick={onItemClick}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};
