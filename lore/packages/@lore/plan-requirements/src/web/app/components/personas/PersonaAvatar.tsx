import { Avatar, AvatarFallback, cn } from "@alepha/ui";

export interface PersonaAvatarProps {
  name: string;
  className?: string;
}

/**
 * A persona's avatar (#E153): its two initials in the kit's `Avatar`, the
 * one every member's picture is drawn with. A persona has no picture.
 */
const PersonaAvatar = (props: PersonaAvatarProps) => (
  <Avatar className={cn("size-6", props.className)} title={props.name}>
    <AvatarFallback className="text-[10px] font-semibold">
      {props.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")}
    </AvatarFallback>
  </Avatar>
);

export default PersonaAvatar;
