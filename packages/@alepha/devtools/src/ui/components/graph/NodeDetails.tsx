import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Separator } from "@alepha/ui/components/ui/separator";
import { ArrowDown, ArrowUp, Box, X } from "lucide-react";

import { getModuleColor } from "./constants.ts";
import type { ProviderNodeData } from "./types.ts";

interface NodeDetailsProps {
  node: { id: string; data: ProviderNodeData } | null;
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

export const NodeDetails = (props: NodeDetailsProps) => {
  if (!props.node) return null;

  const { data } = props.node;
  const moduleColor = getModuleColor(data.module);
  const isModule = data.isModule;

  return (
    <div className="bg-card border-border absolute right-4 top-4 z-10 w-[280px] rounded-lg border p-4 shadow-lg">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex flex-1 flex-col gap-1">
          <span className="break-words text-sm font-semibold">
            {data.label}
          </span>
          {!isModule && data.module && (
            <Badge
              variant="outline"
              className="w-fit text-[10px]"
              style={{
                backgroundColor: `${moduleColor}20`,
                color: moduleColor,
                borderColor: `${moduleColor}40`,
              }}
            >
              {data.module}
            </Badge>
          )}
          {isModule && data.providerCount !== undefined && (
            <span className="text-muted-foreground text-xs">
              {data.providerCount} services
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {!isModule && data.aliases && data.aliases.length > 0 && (
        <>
          <Separator className="my-2" />
          <p className="text-muted-foreground mb-1 text-xs">Aliases</p>
          <div className="flex flex-wrap gap-1">
            {data.aliases.map((alias) => (
              <Badge key={alias} variant="outline" className="text-[10px]">
                {alias}
              </Badge>
            ))}
          </div>
        </>
      )}

      {isModule && data.providers && data.providers.length > 0 && (
        <>
          <Separator className="my-2" />
          <div className="mb-1 flex items-center gap-1">
            <Box className="size-3 opacity-50" />
            <span className="text-muted-foreground text-xs">
              Services ({data.providers.length})
            </span>
          </div>
          <div className="h-[100px] overflow-auto">
            <div className="flex flex-col gap-0.5">
              {data.providers.map((provider) => (
                <span key={provider} className="text-xs">
                  {provider.split(".").pop()}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <Separator className="my-2" />

      <div className="overflow-auto" style={{ height: isModule ? 120 : 200 }}>
        <div className="flex flex-col gap-3">
          {data.dependencies.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1">
                <ArrowDown className="size-3 opacity-50" />
                <span className="text-muted-foreground text-xs">
                  {isModule ? "Depends on" : "Dependencies"} (
                  {data.dependencies.length})
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {data.dependencies.map((dep) => (
                  <button
                    type="button"
                    key={dep}
                    className="text-left text-xs text-blue-500 hover:underline"
                    onClick={() => props.onNodeClick(dep)}
                  >
                    {dep}
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.dependents.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1">
                <ArrowUp className="size-3 opacity-50" />
                <span className="text-muted-foreground text-xs">
                  Used by ({data.dependents.length})
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {data.dependents.map((dep) => (
                  <button
                    type="button"
                    key={dep}
                    className="text-left text-xs text-blue-500 hover:underline"
                    onClick={() => props.onNodeClick(dep)}
                  >
                    {dep}
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.dependencies.length === 0 && data.dependents.length === 0 && (
            <span className="text-muted-foreground text-xs">
              No dependencies
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
