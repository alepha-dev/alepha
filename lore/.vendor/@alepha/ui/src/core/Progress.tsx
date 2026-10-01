import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "./utils.ts";

export type ProgressProps = ProgressPrimitive.Root.Props;

const Progress = (props: ProgressProps) => {
  const { className, children, value, ...rest } = props;
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex flex-wrap gap-3", className)}
      {...rest}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
};

export type ProgressTrackProps = ProgressPrimitive.Track.Props;

const ProgressTrack = (props: ProgressTrackProps) => {
  const { className, ...rest } = props;
  return (
    <ProgressPrimitive.Track
      className={cn(
        "bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full",
        className,
      )}
      data-slot="progress-track"
      {...rest}
    />
  );
};

export type ProgressIndicatorProps = ProgressPrimitive.Indicator.Props;

const ProgressIndicator = (props: ProgressIndicatorProps) => {
  const { className, ...rest } = props;
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("bg-primary h-full transition-all", className)}
      {...rest}
    />
  );
};

export type ProgressLabelProps = ProgressPrimitive.Label.Props;

const ProgressLabel = (props: ProgressLabelProps) => {
  const { className, ...rest } = props;
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...rest}
    />
  );
};

export type ProgressValueProps = ProgressPrimitive.Value.Props;

const ProgressValue = (props: ProgressValueProps) => {
  const { className, ...rest } = props;
  return (
    <ProgressPrimitive.Value
      className={cn(
        "text-muted-foreground ml-auto text-sm tabular-nums",
        className,
      )}
      data-slot="progress-value"
      {...rest}
    />
  );
};

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
};
