import {
  IconAt,
  IconCalendar,
  IconClock,
  IconColorPicker,
  IconFile,
  IconHash,
  IconKey,
  IconLetterCase,
  IconLink,
  IconList,
  IconMail,
  IconPalette,
  IconPhone,
  IconSelector,
  IconToggleLeft,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

/**
 * Icon size presets following Mantine's size conventions
 */
export const ICON_SIZES = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

/**
 * Get the default icon for an input based on its type, format, or name.
 */
export const getDefaultIcon = (params: {
  type?: string;
  format?: string;
  name?: string;
  isEnum?: boolean;
  isArray?: boolean;
  size?: IconSize;
}): ReactNode => {
  const { type, format, name, isEnum, isArray, size = "sm" } = params;
  const iconSize = ICON_SIZES[size];

  // Format-based icons (highest priority)
  if (format) {
    switch (format) {
      case "email":
        return <IconMail size={iconSize} />;
      case "url":
      case "uri":
        return <IconLink size={iconSize} />;
      case "tel":
      case "phone":
        return <IconPhone size={iconSize} />;
      case "date":
        return <IconCalendar size={iconSize} />;
      case "date-time":
        return <IconCalendar size={iconSize} />;
      case "time":
        return <IconClock size={iconSize} />;
      case "color":
        return <IconColorPicker size={iconSize} />;
      case "uuid":
        return <IconKey size={iconSize} />;
    }
  }

  // Name-based icons (medium priority)
  if (name) {
    const nameLower = name.toLowerCase();
    if (nameLower.includes("password") || nameLower.includes("secret")) {
      return <IconKey size={iconSize} />;
    }
    if (nameLower.includes("email") || nameLower.includes("mail")) {
      return <IconMail size={iconSize} />;
    }
    if (nameLower.includes("url") || nameLower.includes("link")) {
      return <IconLink size={iconSize} />;
    }
    if (nameLower.includes("phone") || nameLower.includes("tel")) {
      return <IconPhone size={iconSize} />;
    }
    if (nameLower.includes("color")) {
      return <IconPalette size={iconSize} />;
    }
    if (nameLower.includes("file") || nameLower.includes("upload")) {
      return <IconFile size={iconSize} />;
    }
    if (nameLower.includes("date")) {
      return <IconCalendar size={iconSize} />;
    }
    if (nameLower.includes("time")) {
      return <IconClock size={iconSize} />;
    }
  }

  // Type-based icons (lowest priority)
  if (isEnum || isArray) {
    return <IconSelector size={iconSize} />;
  }

  if (type) {
    switch (type) {
      case "boolean":
        return <IconToggleLeft size={iconSize} />;
      case "number":
      case "integer":
        return <IconHash size={iconSize} />;
      case "array":
        return <IconList size={iconSize} />;
      case "string":
        return <IconLetterCase size={iconSize} />;
    }
  }

  // Default icon
  return <IconAt size={iconSize} />;
};
