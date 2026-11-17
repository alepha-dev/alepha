import type { AutomationPresetSketch as Sketch } from "../../../../../api/schemas/automationPresetSketchSchema.ts";

export interface AutomationPresetSketchProps {
  sketch: Sketch;
  label: string;
}

/**
 * Node boxes in layout units: the layout's columns are 280 apart and its
 * rows 140, so a box leaves room for the wire between two.
 */
const BOX = { width: 200, height: 72 };

/**
 * A preset's graph as a small static drawing (#Q3812): a box per node in
 * its kind's colour, a wire per edge, placed by `AutomationGraph.layout`.
 * An SVG, never a React Flow instance: the gallery shows many at once.
 */
const AutomationPresetSketch = (props: AutomationPresetSketchProps) => {
  const nodes = props.sketch.nodes;
  if (!nodes.length) return null;
  const width = Math.max(...nodes.map((node) => node.x)) + BOX.width;
  const height = Math.max(...nodes.map((node) => node.y)) + BOX.height;
  const at = new Map(nodes.map((node) => [node.id, node]));
  const colours: Record<string, string> = {
    source: "fill-primary/15 stroke-primary",
    read: "fill-muted stroke-muted-foreground",
    condition: "fill-warning/15 stroke-warning",
    action: "fill-success/15 stroke-success",
    transform: "fill-muted stroke-muted-foreground",
  };
  return (
    <svg
      viewBox={`-8 -8 ${width + 16} ${height + 16}`}
      className="h-14 w-full"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={props.label}
      data-testid="automation-preset-sketch"
    >
      {props.sketch.edges.map((edge) => {
        const from = at.get(edge.from);
        const to = at.get(edge.to);
        if (!from || !to) return null;
        const x1 = from.x + BOX.width;
        const y1 = from.y + BOX.height / 2;
        const x2 = to.x;
        const y2 = to.y + BOX.height / 2;
        const mid = (x1 + x2) / 2;
        return (
          <path
            key={`${edge.from}:${edge.to}`}
            d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
            className="stroke-muted-foreground fill-none"
            strokeWidth={6}
          />
        );
      })}
      {nodes.map((node) => (
        <rect
          key={node.id}
          x={node.x}
          y={node.y}
          width={BOX.width}
          height={BOX.height}
          rx={16}
          strokeWidth={6}
          className={colours[node.kind] ?? colours.read}
          data-kind={node.kind}
        />
      ))}
    </svg>
  );
};

export default AutomationPresetSketch;
