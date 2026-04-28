import type { IconHint } from "alepha/react/form";
import {
  AtSign,
  Calendar,
  Clock,
  File,
  Hash,
  Link,
  List,
  Lock,
  Phone,
  ToggleLeft,
  Type,
  User,
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

/**
 * Maps a semantic {@link IconHint} to a lucide icon component.
 * Returns `undefined` if the hint is unknown or not provided.
 */
export const iconFor = (hint?: IconHint): IconComponent | undefined =>
  hint ? map[hint] : undefined;
