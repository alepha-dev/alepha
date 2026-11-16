import { cn } from "@alepha/ui";

export interface ActorAvatarsProps {
  actors: Array<{ number: number; name: string; role?: string }>;
  className?: string;
}

/**
 * Who plays a use case, as stacked initials (#E153): one disc per persona,
 * its name in the tooltip.
 */
const ActorAvatars = (props: ActorAvatarsProps) => (
  <div className={cn("flex -space-x-1.5", props.className)}>
    {props.actors.map((actor) => (
      <span
        key={actor.number}
        title={actor.name}
        className="bg-muted text-muted-foreground ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2"
      >
        {actor.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join("")}
      </span>
    ))}
  </div>
);

export default ActorAvatars;
