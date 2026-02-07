import { Badge, Tooltip } from "@mantine/core";
import type { DevEntityColumn } from "./types.ts";

interface ColumnBadgeProps {
  column: DevEntityColumn;
  size?: "xs" | "sm";
}

export const ColumnBadge = ({ column, size = "xs" }: ColumnBadgeProps) => {
  const badges: Array<{ label: string; tooltip: string }> = [];

  if (column.primaryKey) {
    badges.push({ label: "PK", tooltip: "Primary Key" });
  }
  if (column.identity) {
    badges.push({ label: "ID", tooltip: "Auto-increment Identity" });
  }
  if (column.ref) {
    badges.push({
      label: "FK",
      tooltip: `Foreign Key → ${column.ref.entity}.${column.ref.column}`,
    });
  }
  if (column.createdAt) {
    badges.push({ label: "C", tooltip: "Created At (auto-set on insert)" });
  }
  if (column.updatedAt) {
    badges.push({ label: "U", tooltip: "Updated At (auto-set on update)" });
  }
  if (column.deletedAt) {
    badges.push({ label: "D", tooltip: "Deleted At (soft delete)" });
  }
  if (column.version) {
    badges.push({ label: "V", tooltip: "Version (optimistic locking)" });
  }

  return (
    <>
      {badges.map((b) => (
        <Tooltip key={b.label} label={b.tooltip}>
          <Badge size={size} variant="light" color="blue">
            {b.label}
          </Badge>
        </Tooltip>
      ))}
      {column.nullable && (
        <Tooltip label="Nullable">
          <Badge size={size} variant="outline" color="gray">
            ?
          </Badge>
        </Tooltip>
      )}
    </>
  );
};
