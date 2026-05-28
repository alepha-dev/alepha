import * as React from "react";

void React;

import type { IconHint } from "alepha/react/form";
import {
  AtSign,
  Calendar,
  Clock,
  Cog,
  Download,
  File,
  Hash,
  Key,
  Link,
  List,
  Lock,
  Phone,
  RotateCcw,
  ToggleLeft,
  Type,
  Upload,
  User,
  Wrench,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const map: Record<IconHint, IconComponent> = {
  email: AtSign,
  password: Lock,
  phone: Phone,
  url: Link,
  number: Hash,
  calendar: Calendar,
  clock: Clock,
  list: List,
  text: Type,
  user: User,
  file: File,
  switch: ToggleLeft,
};

const namedIcons: Record<string, IconComponent> = {
  ...map,
  key: Key,
  cog: Cog,
  download: Download,
  upload: Upload,
  wrench: Wrench,
  "rotate-ccw": RotateCcw,
};

/**
 * Maps a semantic {@link IconHint} or an icon name string to a lucide
 * component. Returns `undefined` if not found.
 */
export const iconFor = (
  hint?: IconHint | string | null,
): IconComponent | undefined => {
  if (!hint) return undefined;
  return namedIcons[hint as string];
};
