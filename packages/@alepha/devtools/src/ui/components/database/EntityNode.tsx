import { Badge } from "@alepha/ui/components/ui/badge";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Key, Link2 } from "lucide-react";

export const EntityNode = (props: NodeProps) => {
  const entity = props.data as any;

  return (
    <div className="bg-card border-border min-w-[240px] overflow-hidden rounded-lg border">
      <Handle type="target" position={Position.Top} />

      {/* Header */}
      <div className="bg-muted border-border border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{entity.name}</span>
          <Badge variant="secondary" className="text-[10px]">
            {entity.provider}
          </Badge>
        </div>
      </div>

      {/* Columns */}
      <div className="flex flex-col">
        {(entity.columns ?? []).map((col: any) => (
          <div
            key={col.name}
            className="border-border/20 flex flex-nowrap items-center gap-2 border-b px-3 py-1"
          >
            {col.primaryKey && <Key className="size-2.5 text-yellow-500" />}
            {col.ref && <Link2 className="size-2.5 text-blue-500" />}
            {!col.primaryKey && !col.ref && (
              <span className="inline-block w-2.5" />
            )}
            <span className="flex-1 font-mono text-[11px]">{col.name}</span>
            <span className="text-muted-foreground font-mono text-[10px]">
              {col.type}
            </span>
            {col.nullable && (
              <span className="text-muted-foreground text-[9px]">?</span>
            )}
          </div>
        ))}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};
