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
  type MenuProps,
  type MenuTargetProps,
  ThemeIcon,
  Tooltip,
  type TooltipProps,
} from "@mantine/core";
import { IconCheck, IconChevronRight } from "@tabler/icons-react";
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

  /**
   * Whether the menu item is active
   */
  active?: boolean;
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

  on?: "hover" | "click";

  targetProps?: MenuTargetProps;
  menuProps?: MenuProps;
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

  /**
   * Icon to display on the left side of the button.
   * If no children are provided, the button will be styled as an icon-only button.
   */
  icon?: ReactNode;
}

export type ActionProps = ActionCommonProps &
  (
    | ActionNavigationButtonProps
    | ActionClickButtonProps
    | ActionSubmitButtonProps
    | ActionHookButtonProps
    | {}
  );

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

  // Render submenu if it has children
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

  // render regular menu item
  return (
    <Menu.Item
      key={index}
      leftSection={item.icon}
      onClick={item.onClick}
      color={item.color}
      rightSection={
        item.active ? (
          <ThemeIcon size={"xs"} variant={"transparent"}>
            <IconCheck />
          </ThemeIcon>
        ) : undefined
      }
    >
      {item.label}
    </Menu.Item>
  );
};

const ActionButton = (_props: ActionProps) => {
  const props = { variant: "subtle", ..._props };
  const { tooltip, menu, icon, ...restProps } = props;

  if (props.icon) {
    const icon = (
      <ThemeIcon variant={"transparent"} size={"xs"}>
        {props.icon}
      </ThemeIcon>
    );
    if (!props.children) {
      restProps.children = icon;
      restProps.p ??= "xs";
    } else {
      restProps.leftSection = icon;
    }
  }

  if (props.leftSection && !props.children) {
    restProps.className ??= "mantine-Action-iconOnly";
    restProps.p ??= "xs";
  }

  if (props.textVisibleFrom) {
    const { children, textVisibleFrom, leftSection, ...rest } = restProps;
    return (
      <>
        <Flex w={"100%"} visibleFrom={textVisibleFrom}>
          <ActionButton
            flex={1}
            {...rest}
            leftSection={leftSection}
            tooltip={tooltip}
            menu={menu}
          >
            {children}
          </ActionButton>
        </Flex>
        <Flex w={"100%"} hiddenFrom={textVisibleFrom}>
          <ActionButton px={"xs"} {...rest} tooltip={tooltip} menu={menu}>
            {leftSection}
          </ActionButton>
        </Flex>
      </>
    );
  }

  const renderAction = () => {
    if ("href" in restProps && restProps.href) {
      return (
        <ActionNavigationButton {...restProps} href={restProps.href}>
          {restProps.children}
        </ActionNavigationButton>
      );
    }

    delete (restProps as any).classNameActive;
    delete (restProps as any).variantActive;

    if ("action" in restProps && restProps.action) {
      return (
        <ActionHookButton {...restProps} action={restProps.action}>
          {restProps.children}
        </ActionHookButton>
      );
    }

    if ("onClick" in restProps && restProps.onClick) {
      return (
        <ActionClickButton {...restProps} onClick={restProps.onClick}>
          {restProps.children}
        </ActionClickButton>
      );
    }

    if ("form" in restProps && restProps.form) {
      return (
        <ActionSubmitButton {...restProps} form={restProps.form}>
          {restProps.children}
        </ActionSubmitButton>
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
        trigger={menu.on === "hover" ? "hover" : "click"}
        {...menu.menuProps}
      >
        <Menu.Target {...menu.targetProps}>{actionElement}</Menu.Target>
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

export default ActionButton;

// =====================================================================================================================
// Specific Action Variants

// ---------------------------------------------------------------------------------------------------------------------

// Action Submit

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionSubmitButtonProps extends ButtonProps {
  form: FormModel<any>;
}

/**
 * Action button that submits a form with loading and disabled state handling.
 */
const ActionSubmitButton = (props: ActionSubmitButtonProps) => {
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

// Action with useAction Hook

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionHookButtonProps extends ButtonProps {
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
 * <ActionButton action={saveAction}>
 *   Save
 * </ActionButton>
 * ```
 */
const ActionHookButton = (props: ActionHookButtonProps) => {
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

// Action Click

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionClickButtonProps extends ButtonProps {
  onClick: (e: any) => any;
}

/**
 * Basic action button that handles click events with loading and error handling.
 *
 * @example
 * ```tsx
 * <ActionButton onClick={() => api.doSomething()}>
 *   Do Something
 * </ActionButton>
 * ```
 */
const ActionClickButton = (props: ActionClickButtonProps) => {
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

// Action Navigation

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionNavigationButtonProps extends ButtonProps {
  href: string;
  active?: Partial<UseActiveOptions> | false;
  routerGoOptions?: RouterGoOptions;
  classNameActive?: string;
  variantActive?: ButtonProps["variant"];
}

/**
 * Action for navigation with active state support.
 */
const ActionNavigationButton = (props: ActionNavigationButtonProps) => {
  const {
    active: options,
    classNameActive,
    variantActive,
    routerGoOptions,
    ...buttonProps
  } = props;
  const router = useRouter();
  const { isPending, isActive } = useActive(
    options ? { href: props.href, ...options } : { href: props.href },
  );
  const anchorProps = router.anchor(props.href, routerGoOptions);

  const className = buttonProps.className || "";
  if (isActive && options !== false && classNameActive) {
    buttonProps.className = `${className} ${classNameActive}`.trim();
  }

  return (
    <Button
      component={"a"}
      loading={isPending}
      {...buttonProps}
      {...anchorProps}
      variant={
        isActive && options !== false
          ? (variantActive ?? "filled")
          : (buttonProps.variant ?? "subtle")
      }
    >
      {props.children}
    </Button>
  );
};
