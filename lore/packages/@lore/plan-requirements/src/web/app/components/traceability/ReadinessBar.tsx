import { Progress } from "@alepha/ui";

export interface ReadinessBarProps {
  verified: number;
  total: number;
}

/**
 * How much of a priority is verified (#E153): the kit's `Progress`, the bar
 * an epic's progress is drawn with.
 */
const ReadinessBar = (props: ReadinessBarProps) => (
  <Progress
    className="w-24"
    value={props.total ? Math.round((props.verified / props.total) * 100) : 0}
  />
);

export default ReadinessBar;
