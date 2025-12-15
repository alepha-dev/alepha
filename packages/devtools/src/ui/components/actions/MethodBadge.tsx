import { Badge } from "@mantine/core";
import { METHOD_COLORS } from "./constants.ts";

interface MethodBadgeProps {
  method: string;
}

export const MethodBadge = ({ method }: MethodBadgeProps) => (
  <Badge
    variant="light"
    color={METHOD_COLORS[method.toUpperCase()] || "gray"}
    size="sm"
    radius="sm"
    w={60}
  >
    {method.toUpperCase()}
  </Badge>
);
