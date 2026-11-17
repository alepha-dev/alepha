import { AvatarGroup } from "@alepha/ui";

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
  <AvatarGroup className={props.className}>
    {props.actors.map((actor) => (
      <PersonaAvatar key={actor.number} name={actor.name} />
    ))}
  </AvatarGroup>
);

export default ActorAvatars;
