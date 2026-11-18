import { Avatar, AvatarFallback, cn } from "@alepha/ui";

export interface PersonaAvatarProps {
  name: string;
  className?: string;
}

/**
 * The soft hues an avatar is drawn in, one per persona, picked from its
 * name so a persona keeps its colour on every screen.
 */
const AVATAR_HUES = [
  "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  "bg-pink-500/20 text-pink-800 dark:text-pink-300",
  "bg-sky-500/20 text-sky-800 dark:text-sky-300",
  "bg-violet-500/20 text-violet-800 dark:text-violet-300",
  "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
  "bg-orange-500/20 text-orange-800 dark:text-orange-300",
] as const;

const hueOf = (name: string): string => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
};

/**
 * Two letters, always: the first letter of the first two words ("Device
 * Agent" is DA), or the first two letters of a single word ("Camille" is
 * CA), so no avatar shows a lone letter.
 */
const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${words[0][0]}${words[1][0]}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
};

/**
 * A persona's avatar (#E153): its two initials in the kit's `Avatar`, the
 * one every member's picture is drawn with, on a hue of its own. A persona
 * has no picture.
 */
const PersonaAvatar = (props: PersonaAvatarProps) => (
  <Avatar className={cn("size-6", props.className)} title={props.name}>
    <AvatarFallback
      className={cn("text-[10px] font-semibold", hueOf(props.name))}
    >
      {initialsOf(props.name)}
    </AvatarFallback>
  </Avatar>
);

export default PersonaAvatar;
