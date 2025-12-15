import { ui } from "@alepha/ui";
import { type ComponentType, isValidElement, type ReactNode } from "react";
import { isComponentType } from "./isComponentType.ts";

export const renderIcon = (icon: ReactNode | ComponentType): ReactNode => {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  if (isComponentType(icon)) {
    const IconComponent = icon;
    return <IconComponent size={ui.sizes.icon.md} />;
  }
  return icon as ReactNode;
};
