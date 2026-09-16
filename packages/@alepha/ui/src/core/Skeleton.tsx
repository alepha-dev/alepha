import { cn } from "./utils.ts";

export type SkeletonProps = React.ComponentProps<"div">;

const Skeleton = (props: SkeletonProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...rest}
    />
  );
};

export { Skeleton };
