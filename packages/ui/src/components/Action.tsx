import {
  type RouterGoOptions,
  type UseActionReturn,
  type UseActiveOptions,
  useAction,
  useActive,
  useRouter,
} from "@alepha/react";
import { type FormModel, useFormState } from "@alepha/react-form";
import {
  Button,
  type ButtonProps,
  Flex,
  Menu,
  Tooltip,
  type TooltipProps,
} from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface ActionMenuItem {
  /**
   * Menu item type
   */
  type?: "item" | "divider" | "label";

  /**
   * Label text for the menu item
   */
  label?: string;

  /**
   * Icon element to display before the label
   */
  icon?: ReactNode;

  /**
   * Click handler for menu items
   */
  onClick?: () => void;

  /**
   * Color for the menu item (e.g., "red" for danger actions)
   */
  color?: string;

  /**
   * Nested submenu items
   */
  children?: ActionMenuItem[];
}

export interface ActionMenuConfig {
  /**
   * Array of menu items to display
   */
  items: ActionMenuItem[];

  /**
   * Menu position relative to the button
   */
  position?:
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "top"
    | "top-start"
    | "top-end"
    | "left"
    | "right";

  /**
   * Menu width
   */
  width?: number | string;

  /**
   * Menu shadow
   */
  shadow?: "xs" | "sm" | "md" | "lg" | "xl";
}

export interface ActionCommonProps extends ButtonProps {
  children?: ReactNode;
  textVisibleFrom?: "xs" | "sm" | "md" | "lg" | "xl";

  /**
   * Tooltip to display on hover. Can be a string for simple tooltips
   * or a TooltipProps object for advanced configuration.
   */
  tooltip?: string | TooltipProps;

  /**
   * Menu configuration. When provided, the action will display a dropdown menu.
   */
  menu?: ActionMenuConfig;

  /**
   * If set, a confirmation dialog will be shown before performing the action.
   * If `true`, a default title and message will be used.
   * If a string, it will be used as the message with a default title.
   * If an object, it can contain `title` and `message` properties to customize the dialog.
   */
  confirm?: boolean | string | { title?: string; message: string };
}

export type ActionProps = ActionCommonProps &
  (
    | ActiveHrefProps
    | ActionClickProps
    | ActionSubmitProps
    | ActionActionProps
    | {}
  );

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type guard to check if a value is a UseActionReturn object.
 */
export function isActionReturn(
  value: any,
): value is UseActionReturn<any[], any> {
  return (
    value &&
    typeof value === "object" &&
    "run" in value &&
    "loading" in value &&
    "error" in value &&
    "cancel" in value &&
    typeof value.run === "function" &&
    typeof value.loading === "boolean" &&
    typeof value.cancel === "function"
  );
}

// ---------------------------------------------------------------------------------------------------------------------

// Helper function to render menu items recursively
const renderMenuItem = (item: ActionMenuItem, index: number): ReactNode => {
  // Render divider
  if (item.type === "divider") {
    return <Menu.Divider key={index} />;
  }

  // Render label
  if (item.type === "label") {
    return <Menu.Label key={index}>{item.label}</Menu.Label>;
  }

  // Render submenu if has children
  if (item.children && item.children.length > 0) {
    return (
      <Menu key={index} trigger="hover" position="right-start" offset={2}>
        <Menu.Target>
          <Menu.Item
            leftSection={item.icon}
            rightSection={<IconChevronRight size={14} />}
          >
            {item.label}
          </Menu.Item>
        </Menu.Target>
        <Menu.Dropdown>
          {item.children.map((child, childIndex) =>
            renderMenuItem(child, childIndex),
          )}
        </Menu.Dropdown>
      </Menu>
    );
  }

  // Render regular menu item
  return (
    <Menu.Item
      key={index}
      leftSection={item.icon}
      onClick={item.onClick}
      color={item.color}
    >
      {item.label}
    </Menu.Item>
  );
};

const Action = (_props: ActionProps) => {
  const props = { variant: "subtle", ..._props };
  const { tooltip, menu, ...restProps } = props;

  if (props.leftSection && !props.children) {
    restProps.className ??= "mantine-Action-iconOnly";
    restProps.p ??= "xs";
  }

  if (props.textVisibleFrom) {
    const { children, textVisibleFrom, leftSection, ...rest } = restProps;
    return (
      <>
        <Flex w={"100%"} visibleFrom={textVisibleFrom}>
          <Action
            flex={1}
            {...rest}
            leftSection={leftSection}
            tooltip={tooltip}
            menu={menu}
          >
            {children}
          </Action>
        </Flex>
        <Flex w={"100%"} hiddenFrom={textVisibleFrom}>
          <Action px={"xs"} {...rest} tooltip={tooltip} menu={menu}>
            {leftSection}
          </Action>
        </Flex>
      </>
    );
  }

  const renderAction = () => {
    if ("href" in restProps && restProps.href) {
      return (
        <ActionHref {...restProps} href={restProps.href}>
          {restProps.children}
        </ActionHref>
      );
    }

    if ("action" in restProps && restProps.action) {
      return (
        <ActionAction {...restProps} action={restProps.action}>
          {restProps.children}
        </ActionAction>
      );
    }

    if ("onClick" in restProps && restProps.onClick) {
      return (
        <ActionClick {...restProps} onClick={restProps.onClick}>
          {restProps.children}
        </ActionClick>
      );
    }

    if ("form" in restProps && restProps.form) {
      return (
        <ActionSubmit {...restProps} form={restProps.form}>
          {restProps.children}
        </ActionSubmit>
      );
    }

    return <Button {...(restProps as any)}>{restProps.children}</Button>;
  };

  let actionElement = renderAction();

  // Wrap with Menu if provided
  if (menu) {
    actionElement = (
      <Menu
        position={menu.position || "bottom-start"}
        width={menu.width || 200}
        shadow={menu.shadow || "md"}
      >
        <Menu.Target>{actionElement}</Menu.Target>
        <Menu.Dropdown>
          {menu.items.map((item, index) => renderMenuItem(item, index))}
        </Menu.Dropdown>
      </Menu>
    );
  }

  // Wrap with Tooltip if provided
  if (tooltip) {
    const tooltipProps: TooltipProps =
      typeof tooltip === "string"
        ? { label: tooltip, children: actionElement }
        : { ...tooltip, children: actionElement };

    return <Tooltip {...tooltipProps} />;
  }

  return actionElement;
};

export default Action;

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionSubmitProps extends ButtonProps {
  form: FormModel<any>;
}

/**
 * Action button that submits a form with loading and disabled state handling.
 */
const ActionSubmit = (props: ActionSubmitProps) => {
  const { form, ...buttonProps } = props;
  const state = useFormState(form);
  return (
    <Button
      {...buttonProps}
      loading={state.loading}
      disabled={state.loading}
      type={"submit"}
    >
      {props.children}
    </Button>
  );
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionActionProps extends ButtonProps {
  action: UseActionReturn<any[], any>;
}

/**
 * Action button that integrates with useAction hook return value.
 * Automatically handles loading state and executes the action on click.
 *
 * @example
 * ```tsx
 * const saveAction = useAction({
 *   handler: async (data) => {
 *     await api.save(data);
 *   }
 * }, []);
 *
 * <Action action={saveAction}>Save</Action>
 * ```
 */
const ActionAction = (props: ActionActionProps) => {
  const { action, ...buttonProps } = props;

  return (
    <Button
      {...buttonProps}
      disabled={action.loading || props.disabled}
      loading={action.loading}
      onClick={() => action.run()}
    >
      {props.children}
    </Button>
  );
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionClickProps extends ButtonProps {
  onClick: (e: any) => any;
}

/**
 * Basic action button that handles click events with loading and error handling.
 */
const ActionClick = (props: ActionClickProps) => {
  const action = useAction(
    {
      handler: async (e: any) => {
        await props.onClick(e);
      },
      id: "action",
    },
    [props.onClick],
  );

  return (
    <Button
      {...props}
      disabled={action.loading || props.disabled}
      loading={action.loading}
      onClick={action.run}
    >
      {props.children}
    </Button>
  );
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ActiveHrefProps extends ButtonProps {
  href: string;
  active?: Partial<UseActiveOptions> | false;
  routerGoOptions?: RouterGoOptions;
}

/**
 * Action for navigation with active state support.
 */
const ActionHref = (props: ActiveHrefProps) => {
  const { active: options, routerGoOptions, ...buttonProps } = props;
  const router = useRouter();
  const { isPending, isActive } = useActive(
    options ? { href: props.href, ...options } : { href: props.href },
  );
  const anchorProps = router.anchor(props.href, routerGoOptions);

  return (
    <Button
      component={"a"}
      loading={isPending}
      {...anchorProps}
      {...buttonProps}
      variant={isActive && options !== false ? "filled" : "subtle"}
    >
      {props.children}
    </Button>
  );
};
