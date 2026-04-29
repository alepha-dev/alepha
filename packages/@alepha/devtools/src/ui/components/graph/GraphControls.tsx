import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import {
  Box,
  Boxes,
  Download,
  GitGraph,
  LayoutGrid,
  Network,
  Search,
} from "lucide-react";
import type { GraphFilters, LayoutType, ViewMode } from "./types.ts";

interface GraphControlsProps {
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  modules: string[];
  nodeCount: number;
  edgeCount: number;
  onExport: () => void;
}

export const GraphControls = (props: GraphControlsProps) => {
  const isModuleView = props.filters.viewMode === "modules";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={props.filters.viewMode}
        onValueChange={(v) =>
          v &&
          props.onFiltersChange({ ...props.filters, viewMode: v as ViewMode })
        }
      >
        <ToggleGroupItem value="modules">
          <Tooltip>
            <TooltipTrigger asChild>
              <Boxes className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Modules</TooltipContent>
          </Tooltip>
        </ToggleGroupItem>
        <ToggleGroupItem value="providers">
          <Tooltip>
            <TooltipTrigger asChild>
              <Box className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Services</TooltipContent>
          </Tooltip>
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="relative w-[200px]">
        <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          placeholder={
            isModuleView ? "Search modules..." : "Search services..."
          }
          className="h-8 pl-8 text-xs"
          value={props.filters.search}
          onChange={(e) =>
            props.onFiltersChange({
              ...props.filters,
              search: e.currentTarget.value,
            })
          }
        />
      </div>

      {!isModuleView && (
        <Select
          value={props.filters.module}
          onValueChange={(value) =>
            props.onFiltersChange({ ...props.filters, module: value || "all" })
          }
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Filter by module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {props.modules.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={props.filters.hideFramework}
          onCheckedChange={(checked) =>
            props.onFiltersChange({
              ...props.filters,
              hideFramework: checked === true,
            })
          }
        />
        Hide framework
      </label>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={props.layout}
        onValueChange={(v) => v && props.onLayoutChange(v as LayoutType)}
      >
        <ToggleGroupItem value="dagre">
          <Tooltip>
            <TooltipTrigger asChild>
              <LayoutGrid className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Hierarchical</TooltipContent>
          </Tooltip>
        </ToggleGroupItem>
        <ToggleGroupItem value="circular">
          <Tooltip>
            <TooltipTrigger asChild>
              <GitGraph className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Circular</TooltipContent>
          </Tooltip>
        </ToggleGroupItem>
        <ToggleGroupItem value="force">
          <Tooltip>
            <TooltipTrigger asChild>
              <Network className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Force</TooltipContent>
          </Tooltip>
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="flex items-center gap-1">
        <Badge variant="secondary">
          {props.nodeCount} {isModuleView ? "modules" : "services"}
        </Badge>
        <Badge variant="secondary">{props.edgeCount} edges</Badge>
      </div>

      <Button size="sm" variant="ghost" onClick={props.onExport}>
        <Download className="size-3.5" />
      </Button>
    </div>
  );
};
