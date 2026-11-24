import { Skeleton } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useMemo, useState } from "react";

import type { DirectoryController } from "../../../../../../api/controllers/DirectoryController.ts";
import type { FolioGraph as FolioGraphData } from "../../../../../../api/schemas/folioGraphSchema.ts";
import {
  createFolioGraphLayout,
  type FolioGraphLayout,
  stepFolioGraphLayout,
} from "./folioGraphLayout.ts";

export interface FolioGraphProps {
  /**
   * The folio being read, highlighted with its links.
   */
  currentFolioId?: string;
  /**
   * After a node was clicked and its folio opened.
   */
  onOpened?: () => void;
}

/**
 * Every folio label is drawn up to this many folios; past it, only the open
 * folio's and the hovered one's, or the picture is all text.
 */
const ALL_LABELS_UP_TO = 40;

/**
 * The smallest extent the view shows, in layout units, and the margin
 * around the graph.
 */
const MIN_SPAN = 240;
const PAD = 40;

/**
 * The view's nominal height in pixels: what `unit` divides by, so a dot of
 * radius 4 is about 4 pixels in a dialog that tall.
 */
const VIEW_PIXELS = 600;

/**
 * Iterations per animation frame: a few, so five hundred folios still leave
 * the frame time to paint.
 */
const STEPS_PER_FRAME = 4;

/**
 * The project's folios as a graph (#Q4262): one dot per folio, one line per
 * wiki link between two folios, laid out by force over a few frames. The
 * open folio and its links stand out; a click opens a folio.
 */
const FolioGraph = (props: FolioGraphProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<DirectoryController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const [, setFrame] = useState(0);

  const { data } = useQuery(
    {
      key: ["folio-graph", project?.id],
      enabled: !!project,
      handler: () => api.folioGraph({ params: { projectId: project!.id } }),
    },
    [api, project?.id],
  );

  const graph = useMemo(() => (data ? indexGraph(data) : undefined), [data]);
  const layout = useMemo<FolioGraphLayout | undefined>(
    () =>
      graph
        ? createFolioGraphLayout(graph.nodes.length, graph.edges)
        : undefined,
    [graph],
  );

  useEffect(() => {
    if (!layout) return;
    let handle = 0;
    const tick = () => {
      const done = stepFolioGraphLayout(layout, STEPS_PER_FRAME);
      setFrame((n) => n + 1);
      if (!done) handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [layout]);

  if (!graph || !layout || !project) {
    return <Skeleton className="h-full w-full" />;
  }
  if (graph.nodes.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {tr("folios.graph.empty")}
      </p>
    );
  }

  const current = props.currentFolioId
    ? graph.indexOf.get(props.currentFolioId)
    : undefined;
  const focus = hovered ?? current;
  const neighbours = new Set<number>();
  for (const [a, b] of graph.edges) {
    if (a === focus) neighbours.add(b);
    if (b === focus) neighbours.add(a);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    minX = Math.min(minX, layout.x[i]);
    minY = Math.min(minY, layout.y[i]);
    maxX = Math.max(maxX, layout.x[i]);
    maxY = Math.max(maxY, layout.y[i]);
  }
  // A view at least MIN_SPAN wide and tall, centred on the graph: two
  // folios are not blown up to fill the dialog. `unit` is the size of one
  // screen-ish pixel in layout units, so dots, lines and labels keep their
  // size whatever the graph's extent.
  const span = Math.max(maxX - minX, maxY - minY, MIN_SPAN) + PAD * 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const viewBox = `${cx - span / 2} ${cy - span / 2} ${span} ${span}`;
  const unit = span / VIEW_PIXELS;
  const labels = graph.nodes.length <= ALL_LABELS_UP_TO;

  const open = (index: number) => {
    void router.push("projectFoliosFolio", {
      params: {
        projectSlug: project.slug,
        shortId: graph.nodes[index].shortId,
      },
    });
    props.onOpened?.();
  };

  return (
    <svg
      data-testid="folio-graph"
      viewBox={viewBox}
      className="h-full w-full select-none"
      role="img"
      aria-label={tr("folios.graph.title")}
    >
      <g>
        {graph.edges.map(([a, b]) => {
          const lit = a === focus || b === focus;
          return (
            <line
              key={`${a}-${b}`}
              x1={layout.x[a]}
              y1={layout.y[a]}
              x2={layout.x[b]}
              y2={layout.y[b]}
              className={lit ? "stroke-primary" : "stroke-border"}
              strokeWidth={(lit ? 1.5 : 1) * unit}
            />
          );
        })}
      </g>
      <g>
        {graph.nodes.map((node, index) => {
          const isCurrent = index === current;
          const lit = isCurrent || index === hovered || neighbours.has(index);
          return (
            <g
              key={node.id}
              data-testid="folio-graph-node"
              data-current={isCurrent ? "true" : undefined}
              transform={`translate(${layout.x[index]} ${layout.y[index]})`}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(undefined)}
              onClick={() => open(index)}
            >
              <title>{node.title}</title>
              <circle
                r={(4 + Math.min(6, graph.degree[index])) * unit}
                className={
                  isCurrent
                    ? "fill-primary"
                    : lit
                      ? "fill-primary/60"
                      : "fill-muted-foreground/50"
                }
              />
              {(labels || lit) && (
                <text
                  y={(-10 - Math.min(6, graph.degree[index])) * unit}
                  textAnchor="middle"
                  fontSize={(isCurrent ? 12 : 11) * unit}
                  // A label never takes the click from a dot under it.
                  className={
                    isCurrent
                      ? "fill-foreground pointer-events-none font-semibold"
                      : "fill-muted-foreground pointer-events-none"
                  }
                >
                  {node.title}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
};

/**
 * Folio ids to indexes, the edges as index pairs, and each node's degree.
 */
const indexGraph = (data: FolioGraphData) => {
  const indexOf = new Map(data.nodes.map((node, index) => [node.id, index]));
  const edges: Array<[number, number]> = [];
  const degree: number[] = Array.from({ length: data.nodes.length }, () => 0);
  for (const edge of data.edges) {
    const a = indexOf.get(edge.from);
    const b = indexOf.get(edge.to);
    if (a === undefined || b === undefined) continue;
    edges.push([a, b]);
    degree[a]++;
    degree[b]++;
  }
  return { nodes: data.nodes, indexOf, edges, degree };
};

export default FolioGraph;
