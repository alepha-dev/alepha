import {
  Anchor,
  type AnchorProps,
  Button,
  type ButtonProps,
  Flex,
  Menu,
  type MenuItemProps,
  type MenuProps,
  type MenuTargetProps,
  type ThemeIconProps,
  Tooltip,
  type TooltipProps,
  useMantineTheme,
} from "@mantine/core";
import { IconCheck, IconChevronRight } from "@tabler/icons-react";
import { type UseActionReturn, useAction } from "alepha/react";
import { type FormModel, useFormState } from "alepha/react/form";
import {
  type RouterPushOptions,
  type UseActiveOptions,
  useActive,
  useRouter,
} from "alepha/react/router";
import {
  type ButtonHTMLAttributes,
  Children,
  type ComponentType,
  type ReactNode,
} from "react";
import { ui } from "../../constants/ui.ts";
import { isComponentType } from "../../helpers/isComponentType.ts";

export interface ActionMenuItem {
  /**
   * Menu item type
   */
  type?: "item" | "divider" | "label";

  /**
   * Label text for the menu item
   */
  label?: string | ReactNode;

  /**
   * Icon element to display before the label
   */
  icon?: ReactNode;

  /**
   * Click handler for menu items
   */
  onClick?: () => void;

  /**
   * Href for navigation menu items
   */
  href?: string;

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

  /**
   * If set, the button will show only the icon on smaller screens and reveal the text from the specified breakpoint and up.
   */
  textVisibleFrom?: "xs" | "sm" | "md" | "lg" | "xl";

  /**
   * Tooltip to display on hover. Can be a string for simple tooltips
   * or a TooltipProps object for advanced configuration.
   */
  tooltip?: string | number | TooltipProps;

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
  icon?: ReactNode | ComponentType;

  /**
   * Size of the icon. Can be a number (pixels) or a string (e.g., "1em", "20px").
   */
  iconSize?: number | string;

  /**
   * Additional props to pass to the ThemeIcon wrapping the icon.
   */
  themeIconProps?: ThemeIconProps;

  /**
   * Visual intent of the action button.
   */
  intent?: "primary" | "success" | "danger" | "warning" | "info" | "none";

  /**
   * Active state styling for navigation actions. When set, the button will apply active styles based on the current route.
   */
  variant?: ButtonProps["variant"] | "minimal";
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

// ---------------------------------------------------------------------------------------------------------------------

const ActionButton = (_props: ActionProps) => {
  const theme = useMantineTheme();
  const props = { ..._props };

  if (props.variant === "minimal") {
    //props.variant = "default";
    //props.bd = 0;
  }

  const { tooltip, menu, icon, iconSize, ...restProps } = props;

  if (props.intent) {
    if (props.intent === "primary") {
      restProps.color ??= theme.primaryColor;
    } else if (props.intent === "success") {
      restProps.c ??= "white";
      restProps.color ??= "green";
    } else if (props.intent === "danger") {
      restProps.c ??= "white";
      restProps.color ??= "red";
    } else if (props.intent === "warning") {
      restProps.color ??= "yellow";
    } else if (props.intent === "info") {
      restProps.c ??= "white";
      restProps.color ??= "blue";
    }
  }

  if (props.icon) {
    const sizes = ui.sizes.icon as Record<string, number>;
    const iconSize = props.iconSize ?? sizes[props.size || "sm"];
    const icon = isComponentType(props.icon) ? (
      <props.icon size={iconSize} />
    ) : (
      <span>{props.icon as ReactNode}</span>
    );

    if (!props.children) {
      restProps.children = Children.only(icon);
      restProps.p ??= 8;
    } else {
      restProps.leftSection = icon;
    }
  }

  if (props.leftSection && !props.children) {
    restProps.px ??= "xs";
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
          <ActionButton
            px={"xs"}
            {...rest}
            aria-label={typeof children === "string" ? children : undefined}
            tooltip={tooltip}
            menu={menu}
          >
            {leftSection}
          </ActionButton>
        </Flex>
      </>
    );
  }

  const renderAction = () => {
    if ("href" in restProps && restProps.href) {
      if (restProps.href.startsWith("http") || restProps.target) {
        return (
          <ActionHrefButton {...restProps} href={restProps.href}>
            {restProps.children}
          </ActionHrefButton>
        );
      }

      return (
        <ActionNavigationButton {...restProps} href={restProps.href}>
          {restProps.children}
        </ActionNavigationButton>
      );
    }

    delete (restProps as any).classNameActive;
    delete (restProps as any).variantActive;
    delete (restProps as any).propsActive;

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
      if (restProps.type === "reset") {
        return (
          <ActionResetButton {...restProps} form={restProps.form}>
            {restProps.children}
          </ActionResetButton>
        );
      }
      return (
        <ActionSubmitButton {...restProps} form={restProps.form}>
          {restProps.children}
        </ActionSubmitButton>
      );
    }

    return <Button {...(restProps as any)}>{restProps.children}</Button>;
  };

  let actionElement = renderAction();

  // wrap with Menu if provided
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
          {menu.items.map((item, index) => (
            <ActionMenuItem item={item} index={index} key={index} />
          ))}
        </Menu.Dropdown>
      </Menu>
    );
  }

  // Wrap with Tooltip if provided
  if (tooltip) {
    // openDelay: 1000 -> like HTML title attribute
    const defaultTooltipProps: Partial<TooltipProps> = {
      openDelay: 1000,
    };
    const tooltipProps: TooltipProps =
      typeof tooltip === "string" || typeof tooltip === "number"
        ? {
            ...defaultTooltipProps,
            label: tooltip,
            children: actionElement,
          }
        : { ...defaultTooltipProps, ...tooltip, children: actionElement };

    return <Tooltip {...tooltipProps} />;
  }

  return actionElement;
};

export default ActionButton;

// ---------------------------------------------------------------------------------------------------------------------

// Action Submit

// ---------------------------------------------------------------------------------------------------------------------

export interface ActionSubmitButtonProps extends ButtonProps {
  form: FormModel<any>;
  type?: "submit" | "reset";
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

const ActionResetButton = (props: ActionSubmitButtonProps) => {
  const { form, ...buttonProps } = props;
  const state = useFormState(form);
  return (
    <Button {...buttonProps} disabled={state.loading} type={"reset"}>
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
  preventDefault?: boolean;
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
const ActionClickButton = ({
  preventDefault,
  ...props
}: ActionClickButtonProps) => {
  const action = useAction(
    {
      handler: async (e: any) => {
        if (preventDefault) {
          e.preventDefault();
        }
        await props.onClick(e);
      },
    },
    [props.onClick, preventDefault],
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
  routerGoOptions?: RouterPushOptions;
  classNameActive?: string;
  variantActive?: ButtonProps["variant"];
  propsActive?: ButtonProps;
  target?: string;
  anchorProps?: AnchorProps;
  anchor?: boolean;
}

/**
 * Action for navigation with active state support.
 */
const ActionNavigationButton = (props: ActionNavigationButtonProps) => {
  const {
    active: options,
    classNameActive,
    variantActive,
    propsActive,
    routerGoOptions,
    onClick: propsOnClick,
    anchorProps: buttonAnchorProps,
    anchor,
    ...buttonProps
  } = props as ActionNavigationButtonProps & { onClick?: (e: any) => void };
  const router = useRouter();
  const { isPending, isActive } = useActive(
    options ? { href: props.href, ...options } : { href: props.href },
  );
  const anchorProps = router.anchor(props.href, routerGoOptions);

  if (propsActive && isActive) {
    Object.assign(buttonProps, propsActive);
  }

  // Combine passed onClick with router's onClick
  const combinedOnClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    propsOnClick?.(e as any);
    anchorProps.onClick?.(e);
  };

  const className = buttonProps.className || "";
  if (isActive && options !== false && classNameActive) {
    buttonProps.className = `${className} ${classNameActive}`.trim();
  }

  if (buttonAnchorProps || anchor) {
    return (
      <Anchor
        component={"a"}
        {...anchorProps}
        {...(buttonProps as AnchorProps)}
        {...buttonAnchorProps}
        onClick={combinedOnClick}
      >
        {props.children}
      </Anchor>
    );
  }

  return (
    <Button
      component={"a"}
      loading={isPending}
      {...buttonProps}
      {...anchorProps}
      onClick={combinedOnClick}
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

const ActionHrefButton = (props: ActionNavigationButtonProps) => {
  const {
    active: options,
    classNameActive,
    variantActive,
    propsActive,
    routerGoOptions,
    target,
    ...buttonProps
  } = props;

  return (
    <Button component={"a"} target={target} {...buttonProps}>
      {props.children}
    </Button>
  );
};

// ---------------------------------------------------------------------------------------------------------------------

// Helper function to render menu items recursively
const ActionMenuItem = (props: {
  item: ActionMenuItem;
  index: number;
}): ReactNode => {
  const { item, index } = props;

  const router = useRouter();
  const action = useAction(
    {
      handler: async (e: any) => {
        await item.onClick?.();
      },
    },
    [item.onClick],
  );

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
          {item.children.map((child, childIndex) => (
            <ActionMenuItem item={child} index={childIndex} key={childIndex} />
          ))}
        </Menu.Dropdown>
      </Menu>
    );
  }

  const menuItemProps: MenuItemProps & ButtonHTMLAttributes<unknown> = {};
  if (props.item.onClick) {
    menuItemProps.onClick = action.run;
  } else if (props.item.href) {
    Object.assign(menuItemProps, router.anchor(props.item.href));
  }

  // render regular menu item
  return (
    <Menu.Item
      key={index}
      leftSection={
        item.icon ??
        (item.active ? (
          <IconCheck size={ui.sizes.icon.sm} />
        ) : (
          <Flex w={ui.sizes.icon.sm} />
        ))
      }
      onClick={item.onClick}
      color={item.color}
      {...menuItemProps}
    >
      {item.label}
    </Menu.Item>
  );
};
