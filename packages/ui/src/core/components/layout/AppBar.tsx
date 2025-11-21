import { Divider, Flex, type FlexProps } from "@mantine/core";
import type { ReactNode } from "react";
import BurgerButton from "../buttons/BurgerButton.tsx";
import DarkModeButton, {
  type DarkModeButtonProps,
} from "../buttons/DarkModeButton.tsx";
import LanguageButton, {
  type LanguageButtonProps,
} from "../buttons/LanguageButton.tsx";
import OmnibarButton, {
  type OmnibarButtonProps,
} from "../buttons/OmnibarButton.tsx";

export type AppBarItem =
  | AppBarElement
  | AppBarBurger
  | AppBarDark
  | AppBarSearch
  | AppBarLang
  | AppBarSpacer
  | AppBarDivider;

export interface AppBarElement {
  position: "left" | "center" | "right";
  element: ReactNode;
}

export interface AppBarBurger {
  position: "left" | "center" | "right";
  type: "burger";
}

export interface AppBarDark {
  position: "left" | "center" | "right";
  type: "dark";
  props?: DarkModeButtonProps;
}

export interface AppBarSearch {
  position: "left" | "center" | "right";
  type: "search";
  props?: OmnibarButtonProps;
}

export interface AppBarLang {
  position: "left" | "center" | "right";
  type: "lang";
  props?: LanguageButtonProps;
}

export interface AppBarSpacer {
  position: "left" | "center" | "right";
  type: "spacer";
}

export interface AppBarDivider {
  position: "left" | "center" | "right";
  type: "divider";
}

export interface AppBarProps {
  flexProps?: FlexProps;
  items?: AppBarItem[];
}

const AppBar = (props: AppBarProps) => {
  const { items = [] } = props;

  const renderItem = (item: AppBarItem, index: number) => {
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
    }
    if ("element" in item) {
      return item.element;
    }
    return null;
  };

  const leftItems = items.filter((item) => item.position === "left");
  const centerItems = items.filter((item) => item.position === "center");
  const rightItems = items.filter((item) => item.position === "right");

  return (
    <Flex
      h="100%"
      align="center"
      px="md"
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
};

export default AppBar;
