import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useEvents } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useCallback, useState } from "react";
import { ui } from "../../constants/ui.ts";
import { renderIcon } from "../../helpers/renderIcon.tsx";
import ActionButton from "../buttons/ActionButton.tsx";
import Flex from "../Flex.tsx";
import type { SidebarMenuItem, SidebarTheme } from "./Sidebar.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export interface SidebarItemProps {
  item: SidebarMenuItem;
  level: number;
  onItemClick?: (item: SidebarMenuItem) => void;
  theme: SidebarTheme;
}

// ---------------------------------------------------------------------------------------------------------------------

export const SidebarItem = (props: SidebarItemProps) => {
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

  const [isOpen, setIsOpen] = useState<boolean>(isActive(props.item));

  useEvents(
    {
      "react:transition:end": () => {
        // recalculate open state on transition end to ensure correct state after navigation
        if (isActive(props.item)) {
          setIsOpen(true);
        }
      },
    },
    [],
  );

  if (props.level > maxLevel) return null;

  const handleItemClick = (e: MouseEvent) => {
    if (!props.item.target) {
      e.preventDefault();
    }
    if (props.item.children && props.item.children.length > 0) {
      setIsOpen(!isOpen);
    } else {
      props.onItemClick?.(props.item);
      props.item.onClick?.();
    }
  };

  return (
    <Flex direction={"column"} ps={props.level === 0 ? 0 : 32} pos={"relative"}>
      <ActionButton
        w={"100%"}
        justify="space-between"
        href={props.item.href}
        target={props.item.target}
        size={
          props.item.theme?.size ??
          props.theme.button?.size ??
          (props.level === 0 ? "sm" : "xs")
        }
        bd={0}
        fw={"normal"}
        variant={"default"}
        propsActive={{
          variant: "outline",
        }}
        radius={props.item.theme?.radius ?? props.theme.button?.radius ?? "md"}
        onClick={handleItemClick}
        leftSection={
          <Flex w={"100%"} align="center" gap={"sm"}>
            {renderIcon(props.item.icon, ui.sizes.icon.sm)}
            <Flex direction={"column"}>
              <Flex>{props.item.label}</Flex>
            </Flex>
          </Flex>
        }
        rightSection={
          props.item.children ? (
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

      {props.item.children && isOpen && (
        <Flex
          direction={"column"}
          data-parent-level={props.level}
          gap={2}
          py={2}
        >
          <Flex
            style={{
              position: "absolute",
              width: 1,
              background:
                "linear-gradient(to bottom, transparent, var(--mantine-color-default-border), transparent)",
              top: 48,
              left: 20 + 32 * props.level,
              bottom: 16,
            }}
          />
          {props.item.children
            .filter((child) => !child.can || child.can())
            .map((child, index) => (
              <SidebarItem
                key={index}
                item={child}
                level={props.level + 1}
                onItemClick={props.onItemClick}
                theme={props.theme}
              />
            ))}
        </Flex>
      )}
    </Flex>
  );
};
