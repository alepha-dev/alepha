import {
  Flex,
  type FlexProps,
  type MantineBreakpoint,
  Text,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconSquareRounded,
} from "@tabler/icons-react";
import { useEvents } from "alepha/react";
import { useRouter } from "alepha/react/router";
import {
  type ComponentType,
  Fragment,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { ui } from "../../constants/ui.ts";
import { renderIcon } from "../../helpers/renderIcon.tsx";
import ActionButton, { type ActionProps } from "../buttons/ActionButton.tsx";
import OmnibarButton from "../buttons/OmnibarButton.tsx";
import ToggleSidebarButton from "../buttons/ToggleSidebarButton.tsx";

export interface SidebarProps {
  items?: SidebarNode[];
  onItemClick?: (item: SidebarMenuItem) => void;
  onSearchClick?: () => void;
  theme?: SidebarTheme;
  flexProps?: Partial<FlexProps>;
  collapsed?: boolean;
  gap?: MantineBreakpoint | number;
  hide?: {
    paths?: string[];
  };

  /**
   * Whether the sidebar expands on hover when collapsed.
   * @default true
   */
  expandOnHover?: boolean;

  /**
   * Automatically populate the menu from the router's pages.
   */
  autoPopulateMenu?:
    | boolean
    | {
        startsWith: string;
      };
}

export const Sidebar = (props: SidebarProps) => {
  const router = useRouter();
  const { onItemClick } = props;

  const divider = (key: string | number, fill?: boolean) => {
    return (
      <Flex
        key={key}
        h={1}
        bg={"var(--mantine-color-default-border)"}
        my={"xs"}
        mx={
          fill
            ? "calc(-1 * var(--mantine-spacing-md))"
            : props.collapsed
              ? 0
              : "sm"
        }
      />
    );
  };

  const renderNode = (item: SidebarNode, key: number | string) => {
    if ("type" in item) {
      // Hide spacers when collapsed
      if (item.type === "spacer") {
        if (props.collapsed) return null;
        return <Flex key={key} h={16} />;
      }

      if (item.type === "divider") {
        return divider(key, item.fill);
      }

      if (item.type === "search") {
        return (
          <Flex key={key} mb="xs">
            <OmnibarButton collapsed={props.collapsed} />
          </Flex>
        );
      }

      if (item.type === "toggle") {
        return <ToggleSidebarButton key={key} />;
      }

      // Replace sections with dividers when collapsed
      // Replace sections with dividers when collapsed
      if (item.type === "section") {
        // Hide section if all children are hidden
        if (item.children && item.children.length > 0) {
          const hasVisibleChild = item.children.some(
            (child) => !("can" in child) || !child.can || child.can(),
          );
          if (!hasVisibleChild) return null;
        }

        if (props.collapsed) {
          return (
            <Fragment key={key}>
              {divider(`${key}-d`)}
              {item.children?.map((child, index) =>
                renderNode(child, `s${key}-${index}`),
              )}
            </Fragment>
          );
        }
        return (
          <Fragment key={key}>
            <Flex mt={"md"} align={"center"} gap={"xs"}>
              {renderIcon(item.icon, ui.sizes.icon.sm)}
              <Text size={"xs"} c={"dimmed"} tt={"uppercase"} fw={"bold"}>
                {item.label}
              </Text>
            </Flex>
            {item.children?.map((child, index) =>
              renderNode(child, `s${key}-${index}`),
            )}
          </Fragment>
        );
      }
    }

    if ("element" in item) {
      return <Fragment key={key}>{item.element}</Fragment>;
    }

    // Check visibility control
    if (item.can && !item.can()) {
      return null;
    }

    // Hide parent if all children are hidden
    if (item.children && item.children.length > 0) {
      const hasVisibleChild = item.children.some(
        (child) => !child.can || child.can(),
      );
      if (!hasVisibleChild) {
        return null;
      }
    }

    if (props.collapsed) {
      return (
        <SidebarCollapsedItem
          key={key}
          item={item}
          level={0}
          onItemClick={onItemClick}
          theme={props.theme ?? {}}
        />
      );
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

  const getSidebarNodes = (): SidebarNode[] => {
    if (props.items) return props.items;
    if (props.autoPopulateMenu) {
      const items = router.concretePages
        .filter((page) => !page.can || page.can())
        .map((page) => ({
          label: page.label ?? page.name,
          //description: page.description?.slice(0, 32),
          icon: renderIcon(page.icon),
          href: router.path(page.name),
        })) as SidebarMenuItem[];
      if (
        typeof props.autoPopulateMenu === "object" &&
        props.autoPopulateMenu.startsWith
      ) {
        const startsWith = props.autoPopulateMenu.startsWith;
        return items.filter((item) => item.href?.startsWith(startsWith));
      }
      return items;
    }
    return [];
  };

  const padding = "md";
  const gap = props.items ? (props.gap ?? 4) : "xs";
  const menu = useMemo(
    () => getSidebarNodes(),
    [props.items, props.autoPopulateMenu],
  );

  return (
    <Flex
      flex={1}
      py={padding}
      direction={"column"}
      className="alepha-sidebar-scroll"
      {...props.flexProps}
    >
      <Flex gap={gap} px={padding} direction={"column"}>
        {menu
          .filter((it) => it.position === "top")
          .map((item, index) => renderNode(item, index))}
      </Flex>
      <Flex
        gap={gap}
        px={padding}
        direction={"column"}
        flex={1}
        className="alepha-sidebar-scroll"
      >
        {menu
          .filter((it) => !it.position)
          .map((item, index) => renderNode(item, index))}
      </Flex>
      <Flex gap={gap} px={padding} direction={"column"}>
        {menu
          .filter((it) => it.position === "bottom")
          .map((item, index) => renderNode(item, index))}
      </Flex>
    </Flex>
  );
};

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
    if (!props.item.target) {
      e.preventDefault();
    }
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
        target={props.item.target}
        size={
          props.item.theme?.size ??
          props.theme.button?.size ??
          (level === 0 ? "sm" : "xs")
        }
        tooltip={item.description}
        color={"gray"}
        variant={"subtle"}
        variantActive={"default"}
        radius={props.item.theme?.radius ?? props.theme.button?.radius ?? "md"}
        onClick={handleItemClick}
        leftSection={
          <Flex w={"100%"} align="center" gap={"sm"}>
            {renderIcon(item.icon, ui.sizes.icon.sm)}
            <Flex direction={"column"}>
              <Flex>{item.label}</Flex>
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
      />

      {item.children && isOpen && (
        <Flex direction={"column"} data-parent-level={level}>
          <Flex
            style={{
              position: "absolute",
              width: 1,
              background:
                "linear-gradient(to bottom, transparent, var(--mantine-color-default-border), transparent)",
              top: 48,
              left: 20 + 32 * level,
              bottom: 16,
            }}
          />
          {item.children
            .filter((child) => !child.can || child.can())
            .map((child, index) => (
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

// ---------------------------------------------------------------------------------------------------------------------

export interface SidebarItemProps {
  item: SidebarMenuItem;
  level: number;
  onItemClick?: (item: SidebarMenuItem) => void;
  theme: SidebarTheme;
}

const SidebarCollapsedItem = (props: SidebarItemProps) => {
  const { item, level } = props;

  const handleItemClick = () => {
    props.onItemClick?.(item);
    item.onClick?.();
  };

  return (
    <ActionButton
      size={
        props.item.theme?.size ??
        props.theme.button?.size ??
        (level === 0 ? "sm" : "xs")
      }
      variant={"subtle"}
      variantActive={"default"}
      tooltip={{
        label: item.label,
        position: "right",
      }}
      radius={props.item.theme?.radius ?? props.theme.button?.radius ?? "md"}
      onClick={handleItemClick}
      icon={
        renderIcon(item.icon, ui.sizes.icon.sm) ?? (
          <IconSquareRounded size={ui.sizes.icon.sm} />
        )
      }
      href={props.item.href as any}
      target={props.item.target}
      {...props.item.actionProps}
    />
  );
};

// ---------------------------------------------------------------------------------------------------------------------

export type SidebarNode =
  | SidebarMenuItem
  | SidebarSpacer
  | SidebarDivider
  | SidebarSearch
  | SidebarElement
  | SidebarSection
  | SidebarToggle;

export interface SidebarAbstractItem {
  position?: "top" | "bottom";
}

export interface SidebarElement extends SidebarAbstractItem {
  element: ReactNode;
}

export interface SidebarSpacer extends SidebarAbstractItem {
  type: "spacer";
}

export interface SidebarDivider extends SidebarAbstractItem {
  type: "divider";
  fill?: true;
}

export interface SidebarSearch extends SidebarAbstractItem {
  type: "search";
}

export interface SidebarToggle extends SidebarAbstractItem {
  type: "toggle";
}

export interface SidebarSection extends SidebarAbstractItem {
  type: "section";
  label: string;
  icon?: ReactNode | ComponentType;
  children?: SidebarNode[];
}

export interface SidebarMenuItem extends SidebarAbstractItem {
  label: string | ReactNode;
  description?: string;
  icon?: ReactNode | ComponentType;
  href?: string;
  target?: "_blank" | "_self" | "_parent" | "_top";
  activeStartsWith?: boolean; // Use startWith matching for active state
  onClick?: () => void;
  children?: SidebarMenuItem[];
  rightSection?: ReactNode;
  theme?: SidebarButtonTheme;
  actionProps?: ActionProps;
  can?: () => boolean; // Visibility control: true -> visible, false -> hidden
}

export interface SidebarButtonTheme {
  radius?: MantineBreakpoint;
  size?: MantineBreakpoint;
}

export interface SidebarTheme {
  button?: SidebarButtonTheme;
  search?: SidebarButtonTheme;
}
