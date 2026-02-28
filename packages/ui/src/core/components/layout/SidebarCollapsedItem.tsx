import { IconSquareRounded } from "@tabler/icons-react";
import { useRouter } from "alepha/react/router";
import { ui } from "../../constants/ui.ts";
import { renderIcon } from "../../helpers/renderIcon.tsx";
import type {
  ActionMenuConfig,
  ActionMenuItem,
} from "../buttons/ActionButton.tsx";
import ActionButton from "../buttons/ActionButton.tsx";
import Flex from "../Flex.tsx";
import type { SidebarItemProps } from "./SidebarItem.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export const SidebarCollapsedItem = (props: SidebarItemProps) => {
  const router = useRouter();

  const handleItemClick = () => {
    props.onItemClick?.(props.item);
    props.item.onClick?.();
  };

  const hasChildren = props.item.children && props.item.children.length > 0;

  const menu: ActionMenuConfig | undefined = hasChildren
    ? {
        on: "hover",
        position: "right",
        menuProps: {
          arrowPosition: "center",
          arrowSize: 10,
          withArrow: true,
        },
        items: [
          {
            type: "label",
            label: props.item.label,
          },
          ...props.item
            .children!.filter((child) => !child.can || child.can())
            .map(
              (child): ActionMenuItem => ({
                label: child.label as string,
                icon: renderIcon(child.icon, ui.sizes.icon.sm),
                href: child.href,
                active: child.href
                  ? router.isActive(child.href, {
                      startWith: child.activeStartsWith,
                    })
                  : undefined,
              }),
            ),
        ],
      }
    : undefined;

  return (
    <Flex w={"100%"} justify="center" pos={"relative"}>
      <ActionButton
        size={
          props.item.theme?.size ??
          props.theme.button?.size ??
          (props.level === 0 ? "sm" : "xs")
        }
        bd={0}
        variant={"default"}
        propsActive={{
          variant: "outline",
        }}
        tooltip={
          hasChildren
            ? undefined
            : {
                label: props.item.label,
                position: "right",
              }
        }
        onClick={hasChildren ? undefined : handleItemClick}
        icon={
          renderIcon(props.item.icon, ui.sizes.icon.sm) ?? (
            <IconSquareRounded size={ui.sizes.icon.sm} />
          )
        }
        href={hasChildren ? undefined : (props.item.href as any)}
        target={hasChildren ? undefined : props.item.target}
        menu={menu}
        {...props.item.actionProps}
      />
    </Flex>
  );
};
