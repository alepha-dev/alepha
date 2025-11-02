import { useEvents, useRouter } from "@alepha/react";
import {
  Flex,
  type FlexProps,
  type MantineBreakpoint,
  Text,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useCallback, useState } from "react";
import ActionButton, { type ActionProps } from "../buttons/ActionButton.tsx";
import OmnibarButton from "../buttons/OmnibarButton.tsx";

export type MenuNode =
  | SidebarMenuItem
  | SidebarSpacer
  | SidebarDivider
  | SidebarSearch
  | SidebarElement
  | SidebarSection;

export interface SidebarItem {
  position?: "top" | "bottom";
}

export interface SidebarElement extends SidebarItem {
  element: ReactNode;
}

export interface SidebarSpacer extends SidebarItem {
  type: "spacer";
}

export interface SidebarDivider extends SidebarItem {
  type: "divider";
}

export interface SidebarSearch extends SidebarItem {
  type: "search";
}

export interface SidebarSection extends SidebarItem {
  type: "section";
  label: string;
}

export interface SidebarMenuItem extends SidebarItem {
  label: string | ReactNode;
  description?: string;
  icon?: ReactNode;
  href?: string;
  activeStartsWith?: boolean; // Use startWith matching for active state
  onClick?: () => void;
  children?: SidebarMenuItem[];
  rightSection?: ReactNode;
  theme?: SidebarButtonTheme;
  actionProps?: ActionProps;
}

export interface SidebarButtonTheme {
  radius?: MantineBreakpoint;
  size?: MantineBreakpoint;
}

export interface SidebarTheme {
  button?: SidebarButtonTheme;
  search?: SidebarButtonTheme;
}

export interface SidebarProps {
  menu: MenuNode[];
  top?: MenuNode[];
  bottom?: MenuNode[];
  onItemClick?: (item: SidebarMenuItem) => void;
  onSearchClick?: () => void;
  theme?: SidebarTheme;
  flexProps?: Partial<FlexProps>;
}

export const Sidebar = (props: SidebarProps) => {
  const { menu, top = [], bottom = [], onItemClick, onSearchClick } = props;

  const renderNode = (item: MenuNode, key: number) => {
    if ("type" in item) {
      if (item.type === "spacer") {
        return <Flex key={key} h={16} />;
      }
      if (item.type === "divider") {
        return (
          <Flex
            key={key}
            h={1}
            bg={"var(--alepha-border)"}
            my={"md"}
            mx={"sm"}
          />
        );
      }
      if (item.type === "search") {
        return <OmnibarButton key={key} />;
      }
      if (item.type === "section") {
        return (
          <Text
            key={key}
            size={"xs"}
            c={"dimmed"}
            mt={"md"}
            mb={"xs"}
            mx={"sm"}
            tt={"uppercase"}
            fw={"bold"}
          >
            {item.label}
          </Text>
        );
      }
    }
    if ("element" in item) {
      return <Flex key={key}>{item.element}</Flex>;
    }
    return (
      <SidebarItem
        key={key}
        item={item}
        level={0}
        onItemClick={onItemClick}
        theme={props.theme ?? {}}
      />
    );
  };
  const padding = "md";

  return (
    <Flex
      flex={1}
      py={padding}
      direction={"column"}
      className={"overflow-auto"}
      {...props.flexProps}
    >
      <Flex px={padding} direction={"column"}>
        {top.map((item, index) => renderNode(item, index))}
        {menu
          .filter((it) => it.position === "top")
          .map((item, index) => renderNode(item, index + top.length))}
      </Flex>
      <Flex
        px={padding}
        direction={"column"}
        flex={1}
        className={"overflow-auto"}
      >
        {menu
          .filter((it) => !it.position)
          .map((item, index) => renderNode(item, index))}
      </Flex>
      <Flex px={padding} direction={"column"}>
        {bottom.map((item, index) => renderNode(item, index))}
        {menu
          .filter((it) => it.position === "bottom")
          .map((item, index) => renderNode(item, index + bottom.length))}
      </Flex>
    </Flex>
  );
};

// ---------------------------------------------------------------------------------------------------------------------
// SidebarItem - Main component that decides which variant to render
// ---------------------------------------------------------------------------------------------------------------------

export interface SidebarItemProps {
  item: SidebarMenuItem;
  level: number;
  onItemClick?: (item: SidebarMenuItem) => void;
  theme: SidebarTheme;
}

export const SidebarItem = (props: SidebarItemProps) => {
  const { item, level } = props;
  const maxLevel = 2; // 0, 1, 2 = 3 levels total

  const router = useRouter();
  const isActive = useCallback((item: SidebarMenuItem): boolean => {
    if (!item.children) return false;
    for (const child of item.children) {
      if (child.href) {
        if (router.isActive(child.href)) {
          return true;
        }
      }
      if (isActive(child)) {
        return true;
      }
    }
    return false;
  }, []);

  const [isOpen, setIsOpen] = useState<boolean>(isActive(item));

  useEvents(
    {
      "react:transition:end": () => {
        // recalculate open state on transition end to ensure correct state after navigation
        if (isActive(item)) {
          setIsOpen(true);
        }
      },
    },
    [],
  );

  if (level > maxLevel) return null;

  const handleItemClick = (e: MouseEvent) => {
    e.preventDefault();
    if (item.children && item.children.length > 0) {
      setIsOpen(!isOpen);
    } else {
      props.onItemClick?.(item);
      item.onClick?.();
    }
  };

  return (
    <Flex direction={"column"} ps={level === 0 ? 0 : 32} pos={"relative"}>
      <ActionButton
        w={"100%"}
        justify="space-between"
        href={props.item.href}
        variant={"subtle"}
        size={
          props.item.theme?.size ??
          props.theme.button?.size ??
          (level === 0 ? "sm" : "xs")
        }
        variantActive={"default"}
        radius={props.item.theme?.radius ?? props.theme.button?.radius ?? "md"}
        onClick={handleItemClick}
        leftSection={
          <Flex w={"100%"} align="center" gap={"sm"}>
            {item.icon && <Flex>{item.icon}</Flex>}
            <Flex direction={"column"}>
              <Flex>{item.label}</Flex>
              {item.description && (
                <Text size={"xs"} c={"dimmed"}>
                  {item.description}
                </Text>
              )}
            </Flex>
          </Flex>
        }
        rightSection={
          item.children ? (
            <Flex>
              {isOpen ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </Flex>
          ) : (
            props.item.rightSection
          )
        }
        {...props.item.actionProps}
      ></ActionButton>
      {item.children && isOpen && (
        <Flex direction={"column"} data-parent-level={level}>
          <Flex
            style={{
              position: "absolute",
              width: 1,
              background:
                "linear-gradient(to bottom, transparent, var(--alepha-border), transparent)",
              top: 48,
              left: 20 + 32 * level,
              bottom: 16,
            }}
          />
          {item.children.map((child, index) => (
            <SidebarItem
              key={index}
              item={child}
              level={level + 1}
              onItemClick={props.onItemClick}
              theme={props.theme}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
};
