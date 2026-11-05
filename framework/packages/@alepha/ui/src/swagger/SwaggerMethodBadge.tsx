import { Badge, type BadgeTone } from "../core/Badge.tsx";
import { cn } from "../core/utils.ts";

export interface SwaggerMethodBadgeProps {
  method: string;
  className?: string;
}

/**
 * An HTTP method as a fixed-width chip, toned by what the method does: a read
 * is `info`, a create `success`, an update `warning`, a delete `danger`.
 */
export const SwaggerMethodBadge = (props: SwaggerMethodBadgeProps) => {
  const method = props.method.toLowerCase();
  return (
    <Badge
      variant="tint"
      tone={SWAGGER_METHOD_TONES[method] ?? "neutral"}
      className={cn("w-14 font-mono text-[10px] uppercase", props.className)}
    >
      {method}
    </Badge>
  );
};

const SWAGGER_METHOD_TONES: Record<string, BadgeTone> = {
  get: "info",
  post: "success",
  put: "warning",
  patch: "warning",
  delete: "danger",
};
