import type { FlexProps, MantineBreakpoint } from "@mantine/core";
import { useRouter } from "alepha/react/router";
import { type ComponentType, Fragment, type ReactNode, useMemo } from "react";
import { ui } from "../../constants/ui.ts";
import { renderIcon } from "../../helpers/renderIcon.tsx";
import type { ActionProps } from "../buttons/ActionButton.tsx";
import OmnibarButton from "../buttons/OmnibarButton.tsx";
import SidebarCollapseButton from "../buttons/ToggleSidebarButton.tsx";
import Flex from "../Flex.tsx";
import Text from "../Text.tsx";
import { SidebarCollapsedItem } from "./SidebarCollapsedItem.tsx";
import { SidebarItem } from "./SidebarItem.tsx";

// ---------------------------------------------------------------------------------------------------------------------

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
   * Automatically populate the menu from the router's pages.
   */
  autoPopulateMenu?:
    | boolean
    | {
        startsWith: string;
      };
}

// ---------------------------------------------------------------------------------------------------------------------

export const Sidebar = (props: SidebarProps) => {
  const router = useRouter();

  const divider = (
    key: string | number,
    fill?: boolean,
    collapsed?: boolean,
  ) => {
    return (
      <Flex
        key={key}
        h={1}
        bg={"var(--mantine-color-default-border)"}
        my={"xs"}
        mx={
          fill ? "calc(-1 * var(--mantine-spacing-md))" : collapsed ? 0 : "sm"
        }
      />
    );
  };

  const renderNode = (
    item: SidebarNode,
    key: number | string,
    collapsed: boolean,
  ) => {
    if ("type" in item) {
      // Hide spacers when collapsed
      if (item.type === "spacer") {
        if (collapsed) return null;
        return <Flex key={key} h={16} />;
      }

      if (item.type === "divider") {
        return divider(key, item.fill, collapsed);
      }

      if (item.type === "search") {
        return (
          <Flex key={key} mb="xs" w={"100%"} justify="center" pos={"relative"}>
            <OmnibarButton collapsed={collapsed} />
          </Flex>
        );
      }

      if (item.type === "toggle") {
        return <SidebarCollapseButton key={key} />;
      }

      // Replace sections with dividers when collapsed
      if (item.type === "section") {
        // Hide section if all children are hidden
        if (item.children && item.children.length > 0) {
          const hasVisibleChild = item.children.some(
            (child) => !("can" in child) || !child.can || child.can(),
          );
          if (!hasVisibleChild) return null;
        }

        if (collapsed) {
          return (
            <Fragment key={key}>
              {item.children?.map((child, index) =>
                renderNode(child, `s${key}-${index}`, collapsed),
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
              renderNode(child, `s${key}-${index}`, collapsed),
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

    if (collapsed) {
      return (
        <SidebarCollapsedItem
          key={key}
          item={item}
          level={0}
          onItemClick={props.onItemClick}
          theme={props.theme ?? {}}
        />
      );
    }

    return (
      <SidebarItem
        key={key}
        item={item}
        level={0}
        onItemClick={props.onItemClick}
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
  const gap = props.items ? (props.gap ?? 8) : "xs";
  const menu = useMemo(
    () => getSidebarNodes(),
    [props.items, props.autoPopulateMenu],
  );

  const renderSidebar = (collapsed: boolean) => (
    <Flex flex={1} py={padding} direction={"column"} {...props.flexProps}>
      <Flex gap={gap} px={padding} direction={"column"}>
        {menu
          .filter((it) => it.position === "top")
          .map((item, index) => renderNode(item, index, collapsed))}
      </Flex>
      <Flex gap={gap} px={padding} direction={"column"} flex={1}>
        {menu
          .filter((it) => !it.position)
          .map((item, index) => renderNode(item, index, collapsed))}
      </Flex>
      <Flex gap={gap} px={padding} direction={"column"}>
        {menu
          .filter((it) => it.position === "bottom")
          .map((item, index) => renderNode(item, index, collapsed))}
      </Flex>
    </Flex>
  );

  // When collapsed, render both versions and use CSS breakpoints:
  // - Desktop (>=md): show collapsed (icon-only) sidebar
  // - Mobile (<md): show expanded sidebar (drawer with labels)
  if (props.collapsed) {
    return (
      <>
        <Flex flex={1} direction={"column"} visibleFrom="md">
          {renderSidebar(true)}
        </Flex>
        <Flex flex={1} direction={"column"} hiddenFrom="md">
          {renderSidebar(false)}
        </Flex>
      </>
    );
  }

  return renderSidebar(false);
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
