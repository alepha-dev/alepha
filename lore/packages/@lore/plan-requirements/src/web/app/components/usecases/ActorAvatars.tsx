import { AvatarGroup, cn } from "@alepha/ui";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import PersonaAvatar from "../personas/PersonaAvatar.tsx";

export interface ActorAvatarsProps {
  actors: UseCaseResource["actors"];
  className?: string;
}

/**
 * The actors of a use case as overlapping avatars (#E153), each named by
 * its tooltip.
 */
const ActorAvatars = (props: ActorAvatarsProps) => (
  // `-space-x-1`, not the group's `-space-x-2`: a persona's avatar is small
  // (24px) and carries two initials, which half a tile of overlap cut to one.
  <AvatarGroup className={cn("-space-x-1", props.className)}>
    {props.actors.map((actor) => (
      <PersonaAvatar key={actor.number} name={actor.name} />
    ))}
  </AvatarGroup>
);

export default ActorAvatars;
