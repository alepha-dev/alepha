import {
  ActionButton,
  type ActionProps,
  BurgerButton,
  DarkModeButton,
  Flex,
  LanguageButton,
  OmnibarButton,
  type OmnibarButtonProps,
  Text,
} from "@alepha/ui";
import {
  Anchor,
  Container,
  type ContainerProps,
  Divider,
  type FlexProps,
  Image,
} from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { Link, useRouter } from "alepha/react/router";
import type { ComponentType, ReactNode } from "react";

export type AppBarItem =
  | AppBarElement
  | AppBarBurger
  | AppBarDark
  | AppBarSearch
  | AppBarLang
  | AppBarSpacer
  | AppBarDivider
  | AppBarLogo
  | AppBarBack;

export interface AppBarAbstractItem {
  position: "left" | "center" | "right";

  /**
   * Visibility control: return true to show, false to hide.
   */
  can?: () => boolean;
}

export interface AppBarElement extends AppBarAbstractItem {
  element: ReactNode;
}

export interface AppBarBurger extends AppBarAbstractItem {
  type: "burger";
}

export interface AppBarDark extends AppBarAbstractItem {
  type: "dark";
  props?: Partial<ActionProps>;
}

export interface AppBarSearch extends AppBarAbstractItem {
  type: "search";
  props?: OmnibarButtonProps;
}

export interface AppBarLang extends AppBarAbstractItem {
  type: "lang";
  props?: Partial<ActionProps>;
}

export interface AppBarSpacer extends AppBarAbstractItem {
  type: "spacer";
}

export interface AppBarDivider extends AppBarAbstractItem {
  type: "divider";
}

export interface AppBarLogo extends AppBarAbstractItem {
  type: "logo";
  props?: {
    /**
     * Logo image source URL.
     */
    src?: string;

    /**
     * Logo text (used if no src provided).
     */
    text?: string;

    /**
     * Icon component (used if no src or text provided).
     */
    icon?: ReactNode | ComponentType;

    /**
     * Link href when logo is clicked.
     */
    href?: string;

    /**
     * Logo image height in pixels.
     * @default 32
     */
    height?: number;

    /**
     * Logo image width in pixels.
     */
    width?: number;

    /**
     * Font weight for text logo.
     * @default 700
     */
    fontWeight?: number;

    /**
     * Font size for text logo.
     * @default "lg"
     */
    fontSize?: string;
  };
}

export interface AppBarBack extends AppBarAbstractItem {
  type: "back";
  props?: {
    /**
     * Custom label for back button.
     * @default "Back"
     */
    label?: string;

    /**
     * Show only icon without label.
     * @default true
     */
    iconOnly?: boolean;

    /**
     * Custom href to navigate to instead of history back.
     */
    href?: string;

    /**
     * Custom icon component.
     */
    icon?: ReactNode | ComponentType;
  };
}

export interface AppBarProps {
  flexProps?: FlexProps;
  items?: AppBarItem[];

  /**
   * Wrap the AppBar content in a Mantine Container.
   * Pass `true` for default Container, or ContainerProps to customize.
   */
  container?: boolean | ContainerProps;
}

const AppBar = (props: AppBarProps) => {
  const { items = [] } = props;
  const router = useRouter();

  const renderItem = (item: AppBarItem, index: number) => {
    // Check visibility control
    if (item.can && !item.can()) {
      return null;
    }

    if ("type" in item) {
      if (item.type === "burger") {
        return <BurgerButton key={index} />;
      }
      if (item.type === "dark") {
        return <DarkModeButton key={index} {...item.props} />;
      }
      if (item.type === "search") {
        return <OmnibarButton key={index} {...item.props} />;
      }
      if (item.type === "lang") {
        return <LanguageButton key={index} {...item.props} />;
      }
      if (item.type === "spacer") {
        return <Flex key={index} w={16} />;
      }
      if (item.type === "divider") {
        return <Divider key={index} orientation="vertical" />;
      }
      if (item.type === "logo") {
        return renderLogo(item, index);
      }
      if (item.type === "back") {
        return renderBack(item, index);
      }
    }
    if ("element" in item) {
      return item.element;
    }
    return null;
  };

  const renderLogo = (item: AppBarLogo, index: number) => {
    const {
      src,
      text,
      icon,
      href,
      height = 32,
      width,
      fontWeight = 700,
      fontSize = "lg",
    } = item.props ?? {};

    const logoContent = src ? (
      <Image src={src} h={height} w={width} fit="contain" />
    ) : icon ? (
      typeof icon === "function" ? (
        (() => {
          const IconComponent = icon;
          return <IconComponent />;
        })()
      ) : (
        icon
      )
    ) : text ? (
      <Text fw={fontWeight} size={fontSize}>
        {text}
      </Text>
    ) : null;

    if (href) {
      return (
        <Anchor
          component={Link}
          key={index}
          href={href}
          underline="never"
          c="inherit"
        >
          {logoContent}
        </Anchor>
      );
    }

    return <Flex key={index}>{logoContent}</Flex>;
  };

  const renderBack = (item: AppBarBack, index: number) => {
    const { label = "Back", iconOnly = true, href, icon } = item.props ?? {};

    const renderIcon = () => {
      if (!icon) {
        return <IconArrowLeft size={18} />;
      }
      if (typeof icon === "function") {
        const IconComponent = icon as ComponentType<{ size?: number }>;
        return <IconComponent size={18} />;
      }
      return icon;
    };

    const iconElement = renderIcon();

    const handleClick = () => {
      if (href) {
        router.push(href);
      } else {
        router.back();
      }
    };

    if (iconOnly) {
      return (
        <ActionButton
          key={index}
          icon={iconElement}
          variant="subtle"
          color="gray"
          onClick={handleClick}
          tooltip={{ label, position: "bottom" }}
        />
      );
    }

    return (
      <ActionButton
        key={index}
        leftSection={iconElement}
        variant="subtle"
        color="gray"
        onClick={handleClick}
      >
        {label}
      </ActionButton>
    );
  };

  const leftItems = items.filter((item) => item.position === "left");
  const centerItems = items.filter((item) => item.position === "center");
  const rightItems = items.filter((item) => item.position === "right");

  const content = (
    <Flex
      h="100%"
      align="center"
      px={props.container ? 0 : "md"}
      justify="space-between"
      {...props.flexProps}
    >
      <Flex flex={1}>
        {leftItems.map((item, index) => (
          <Flex key={index} ml={index === 0 ? 0 : "md"} align="center">
            {renderItem(item, index)}
          </Flex>
        ))}
      </Flex>
      <Flex>
        {centerItems.map((item, index) => (
          <Flex key={index} mx="md" align="center">
            {renderItem(item, index)}
          </Flex>
        ))}
      </Flex>
      <Flex flex={1} align={"center"} justify={"end"}>
        {rightItems.map((item, index) => (
          <Flex key={index} ml={index === 0 ? 0 : "md"} align="center">
            {renderItem(item, index)}
          </Flex>
        ))}
      </Flex>
    </Flex>
  );

  if (props.container) {
    const containerProps =
      typeof props.container === "boolean" ? {} : props.container;
    return (
      <Container h="100%" {...containerProps}>
        {content}
      </Container>
    );
  }

  return content;
};

export default AppBar;
