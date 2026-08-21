import { Badge } from "@alepha/ui/components/ui/badge";
import { Handle, Position } from "@xyflow/react";

import { getModuleColor } from "./constants.ts";
import type { ProviderNodeData } from "./types.ts";

interface ProviderNodeProps {
  data: ProviderNodeData;
  selected?: boolean;
}

export const ProviderNode = (props: ProviderNodeProps) => {
  const { data, selected } = props;
  const moduleColor = getModuleColor(data.module);
  const isFaded = data.isFaded && !data.isHighlighted;
  const isModule = data.isModule;

  const isActive = selected || data.isSelected;

  return (
    <div
      className="bg-card flex p-2 transition-all"
      style={{
        borderRadius: isModule ? 12 : 8,
        border: `2px solid ${isActive ? moduleColor : "hsl(var(--border))"}`,
        minWidth: isModule ? 200 : 160,
        opacity: isFaded ? 0.3 : 1,
        boxShadow: data.isHighlighted ? `0 0 10px ${moduleColor}` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: moduleColor,
          width: 8,
          height: 8,
          border: "none",
        }}
      />

      <div className="flex flex-col gap-1">
        {isModule ? (
          <>
            <span className="break-words text-xs font-semibold">
              {data.label}
            </span>
            <span className="text-muted-foreground text-xs">
              {data.providerCount} services
            </span>
          </>
        ) : (
          <>
            <span className="break-words text-xs font-semibold">
              {data.label.split(".").pop()}
            </span>
            {data.module && (
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{
                  backgroundColor: `${moduleColor}20`,
                  color: moduleColor,
                  borderColor: `${moduleColor}40`,
                }}
              >
                {data.module}
              </Badge>
            )}
          </>
        )}

        <div className="flex gap-2">
          {data.dependencies.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {data.dependencies.length} deps
            </span>
          )}
          {data.dependents.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {data.dependents.length} refs
            </span>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: moduleColor,
          width: 8,
          height: 8,
          border: "none",
        }}
      />
    </div>
  );
};
