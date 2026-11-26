import { Skeleton } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Eye, EyeOff, Minus, Plus, Shrink } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DirectoryController } from "../../../../../../api/controllers/DirectoryController.ts";
import type { FolioGraph as FolioGraphData } from "../../../../../../api/schemas/folioGraphSchema.ts";
import {
  createFolioGraphLayout,
  folioGraphBounds,
  type FolioGraphLayout,
  stepFolioGraphLayout,
} from "./folioGraphLayout.ts";
import FolioGraphTool from "./FolioGraphTool.tsx";

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
 * The project's folios as a graph (#Q4262, #Q4438): one dot per folio, one
 * line per wiki link between two folios. The layout runs in slices off the
 * render, and the picture is drawn once it is done; the wheel or a pinch
 * zooms, a drag pans, and a click opens a folio. The open folio and its
 * links stand out.
 */
const FolioGraph = (props: FolioGraphProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<DirectoryController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  // The layout of the graph it was computed for: a refetched graph lays out
  // again, and reads as not ready until it has.
  const [laidOut, setLaidOut] = useState<
    { graph: object; layout: FolioGraphLayout } | undefined
  >(undefined);
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Undefined while the view is fitted to the graph.
  const [view, setView] = useState<FolioGraphView | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    start?: { x: number; y: number; view: FolioGraphView };
    pinch?: { distance: number; view: FolioGraphView };
    moved: boolean;
  }>({ pointers: new Map(), moved: false });

  const { data } = useQuery(
    {
      key: ["folio-graph", project?.id],
      enabled: !!project,
      handler: () => api.folioGraph({ params: { projectId: project!.id } }),
    },
    [api, project?.id],
  );

  const graph = useMemo(() => (data ? indexGraph(data) : undefined), [data]);
  const ready = laidOut && laidOut.graph === graph ? laidOut.layout : undefined;

  // Lays the graph out in slices of SLICE_MS, handing the thread back in
  // between, and renders once at the end rather than on every iteration.
  useEffect(() => {
    if (!graph) return;
    const layout = createFolioGraphLayout(graph.nodes.length, graph.edges);
    let handle: ReturnType<typeof setTimeout> | undefined;
    const slice = () => {
      const started = performance.now();
      let done = false;
      while (!done && performance.now() - started < SLICE_MS) {
        done = stepFolioGraphLayout(layout, 2);
      }
      if (done) setLaidOut({ graph, layout });
      else handle = setTimeout(slice, 0);
    };
    slice();
    return () => clearTimeout(handle);
  }, [graph]);

  // The view's pixel size, for a viewBox of the same proportions.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ready]);

  const width = size.width || 800;
  const height = size.height || 600;
  const visible = (index: number) => showUnlinked || ready?.linked[index] === 1;

  const fit = useMemo<FolioGraphView | undefined>(() => {
    if (!ready) return undefined;
    const bounds = folioGraphBounds(
      ready,
      (index) => showUnlinked || ready.linked[index] === 1,
    ) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const spanX = Math.max(bounds.maxX - bounds.minX, MIN_SPAN) + PAD * 2;
    const spanY = Math.max(bounds.maxY - bounds.minY, MIN_SPAN) + PAD * 2;
    return {
      cx: (bounds.minX + bounds.maxX) / 2,
      cy: (bounds.minY + bounds.maxY) / 2,
      scale: Math.min(width / spanX, height / spanY),
    };
  }, [ready, showUnlinked, width, height]);

  // The wheel zooms around the pointer. A native listener, because React's
  // wheel handler is passive and cannot keep the dialog from scrolling.
  const viewRef = useRef<FolioGraphView | undefined>(undefined);
  viewRef.current = view ?? fit;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      const current = viewRef.current;
      if (!current) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      // A trackpad pinch arrives as a wheel with ctrlKey and small deltas.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      setView(
        zoomAround(
          current,
          factor,
          event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2,
        ),
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [ready]);

  const current = props.currentFolioId
    ? graph?.indexOf.get(props.currentFolioId)
    : undefined;
  const focus = dragging ? current : (hovered ?? current);

  const neighbours = useMemo(() => {
    const set = new Set<number>();
    if (!graph || focus === undefined) return set;
    for (const [a, b] of graph.edges) {
      if (a === focus) set.add(b);
      if (b === focus) set.add(a);
    }
    return set;
  }, [graph, focus]);

  // A dot is drawn at most DOT_PIXELS_PER_UNIT pixels per unit of its
  // radius: zoomed out it shrinks with the distances, so dots that do not
  // overlap in the layout never do on screen, and zoomed in it stops
  // growing while the distances do.
  const liveScale = (view ?? fit)?.scale ?? 1;
  const dotScale = Math.min(1, DOT_PIXELS_PER_UNIT / liveScale);

  const edgesLayer = useMemo(() => {
    if (!graph || !ready) return null;
    return graph.edges.map(([a, b]) => {
      const lit = a === focus || b === focus;
      return (
        <line
          key={`${a}-${b}`}
          x1={ready.x[a]}
          y1={ready.y[a]}
          x2={ready.x[b]}
          y2={ready.y[b]}
          className={lit ? "stroke-primary" : "stroke-border"}
          strokeWidth={lit ? 1.5 : 1}
          vectorEffect="non-scaling-stroke"
        />
      );
    });
  }, [graph, ready, focus]);

  const nodesLayer = useMemo(() => {
    if (!graph || !ready) return null;
    const nodes: ReactNode[] = [];
    graph.nodes.forEach((node, index) => {
      if (!showUnlinked && !ready.linked[index]) return;
      const isCurrent = index === current;
      const lit = isCurrent || index === focus || neighbours.has(index);
      nodes.push(
        <g
          key={node.id}
          data-testid="folio-graph-node"
          data-index={index}
          data-current={isCurrent ? "true" : undefined}
          transform={`translate(${ready.x[index]} ${ready.y[index]})`}
          className="cursor-pointer"
        >
          <title>{node.title}</title>
          <circle
            r={ready.radius[index] * dotScale}
            className={
              isCurrent
                ? "fill-primary"
                : lit
                  ? "fill-primary/60"
                  : "fill-muted-foreground/50"
            }
          />
        </g>,
      );
    });
    return nodes;
  }, [graph, ready, current, focus, neighbours, showUnlinked, dotScale]);

  if (!graph || !project) {
    return <Skeleton className="h-full w-full" />;
  }
  if (graph.nodes.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {tr("folios.graph.empty")}
      </p>
    );
  }
  if (!ready || !fit) {
    return (
      <div className="relative h-full w-full">
        <Skeleton className="h-full w-full" />
        <p className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
          {tr("folios.graph.layingOut", {
            args: [String(graph.nodes.length)],
          })}
        </p>
      </div>
    );
  }

  const shown = view ?? fit;
  const viewWidth = width / shown.scale;
  const viewHeight = height / shown.scale;
  const left = shown.cx - viewWidth / 2;
  const top = shown.cy - viewHeight / 2;
  const viewBox = `${left} ${top} ${viewWidth} ${viewHeight}`;
  const unit = 1 / shown.scale;

  const labels = placeLabels({
    graph,
    layout: ready,
    visible,
    focus,
    current,
    neighbours,
    box: { left, top, right: left + viewWidth, bottom: top + viewHeight },
    unit,
    dotScale,
  });

  const unlinkedCount = graph.degree.filter((degree) => degree === 0).length;

  const open = (index: number) => {
    void router.push("projectFoliosFolio", {
      params: {
        projectSlug: project.slug,
        shortId: graph.nodes[index].shortId,
      },
    });
    props.onOpened?.();
  };

  const nodeAt = (target: EventTarget | null) => {
    const node =
      target instanceof Element ? target.closest("[data-index]") : null;
    return node ? Number(node.getAttribute("data-index")) : undefined;
  };

  // Forgets every pointer: after the last one is up, or when a press that
  // never turned into a pan (so never captured) left the graph, whose
  // pointerup the graph then never sees.
  const endGesture = () => {
    const g = gesture.current;
    g.pointers.clear();
    g.pinch = undefined;
    g.start = undefined;
    setDragging(false);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    g.moved = false;
    g.start = { x: event.clientX, y: event.clientY, view: shown };
    if (g.pointers.size === 2) {
      const [p, q] = [...g.pointers.values()];
      g.pinch = {
        distance: Math.hypot(p.x - q.x, p.y - q.y) || 1,
        view: shown,
      };
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (
      g.pointers.has(event.pointerId) &&
      event.pointerType === "mouse" &&
      event.buttons === 0
    ) {
      // A press whose release the graph missed: no button is held any more.
      endGesture();
    }
    if (!g.pointers.has(event.pointerId)) {
      // Plain hover.
      if (!dragging) setHovered(nodeAt(event.target));
      return;
    }
    g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (g.pinch && g.pointers.size >= 2) {
      const [p, q] = [...g.pointers.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const factor = Math.hypot(p.x - q.x, p.y - q.y) / g.pinch.distance;
      g.moved = true;
      setView(
        zoomAround(
          g.pinch.view,
          factor,
          (p.x + q.x) / 2 - rect.left - rect.width / 2,
          (p.y + q.y) / 2 - rect.top - rect.height / 2,
        ),
      );
      return;
    }
    if (!g.start) return;
    const ox = event.clientX - g.start.x;
    const oy = event.clientY - g.start.y;
    if (!g.moved && Math.hypot(ox, oy) < DRAG_THRESHOLD) return;
    if (!g.moved) {
      g.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setView({
      cx: g.start.view.cx - ox / g.start.view.scale,
      cy: g.start.view.cy - oy / g.start.view.scale,
      scale: g.start.view.scale,
    });
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const pinching = !!g.pinch;
    g.pointers.delete(event.pointerId);
    if (g.pointers.size < 2) g.pinch = undefined;
    if (pinching && g.pointers.size === 1) {
      // One finger lifted from a pinch: the other pans on from the view the
      // pinch left, not from where the pinch started.
      const [rest] = [...g.pointers.values()];
      g.start = { x: rest.x, y: rest.y, view: viewRef.current ?? shown };
    }
    if (g.pointers.size === 0) endGesture();
  };

  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    // The click that ends a pan or a pinch opens nothing.
    if (gesture.current.moved) {
      gesture.current.moved = false;
      return;
    }
    const index = nodeAt(event.target);
    if (index !== undefined) open(index);
  };

  const zoomBy = (factor: number) => setView(zoomAround(shown, factor, 0, 0));

  // The keyboard drives the view as the toolbar does: + and - zoom, 0 fits,
  // the arrows pan.
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = 60 / shown.scale;
    const moves: Record<string, () => void> = {
      "+": () => zoomBy(1.4),
      "=": () => zoomBy(1.4),
      "-": () => zoomBy(1 / 1.4),
      "0": () => setView(undefined),
      ArrowLeft: () => setView({ ...shown, cx: shown.cx - step }),
      ArrowRight: () => setView({ ...shown, cx: shown.cx + step }),
      ArrowUp: () => setView({ ...shown, cy: shown.cy - step }),
      ArrowDown: () => setView({ ...shown, cy: shown.cy + step }),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  return (
    <div className="relative h-full w-full">
      {/* A pan and zoom surface driven by pointer, wheel and keys: the
          "application" role is the one that says so, which the rule does
          not count as interactive. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <svg
        ref={svgRef}
        data-testid="folio-graph"
        viewBox={viewBox}
        className={`h-full w-full touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        role="application"
        aria-label={tr("folios.graph.title")}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keyboard pans and zooms it
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (dragging) return;
          setHovered(undefined);
          // Not captured yet, so its pointerup would land elsewhere.
          endGesture();
        }}
        onClick={onClick}
      >
        <g>{edgesLayer}</g>
        <g>{nodesLayer}</g>
        <g className="pointer-events-none">
          {labels.map((label) => (
            <text
              key={label.index}
              x={label.x}
              y={label.y}
              textAnchor="middle"
              fontSize={(label.strong ? LABEL_PX + 1 : LABEL_PX) * unit}
              className={
                label.strong
                  ? "fill-foreground stroke-popover font-semibold"
                  : "fill-muted-foreground stroke-popover"
              }
              // A halo in the dialog's colour, so a label stays readable
              // over the lines it crosses.
              strokeWidth={3 * unit}
              paintOrder="stroke"
            >
              {label.text}
            </text>
          ))}
        </g>
      </svg>
      <div className="chrome absolute top-2 right-2 flex items-center gap-0.5 rounded-md border p-0.5">
        <FolioGraphTool
          label={tr("folios.graph.zoomOut")}
          onClick={() => zoomBy(1 / 1.4)}
        >
          <Minus className="size-3.5" />
        </FolioGraphTool>
        <FolioGraphTool
          label={tr("folios.graph.zoomIn")}
          onClick={() => zoomBy(1.4)}
        >
          <Plus className="size-3.5" />
        </FolioGraphTool>
        <FolioGraphTool
          label={tr("folios.graph.fit")}
          testId="folio-graph-fit"
          onClick={() => setView(undefined)}
        >
          <Shrink className="size-3.5" />
        </FolioGraphTool>
        {unlinkedCount > 0 && (
          <FolioGraphTool
            label={
              showUnlinked
                ? tr("folios.graph.hideUnlinked")
                : tr("folios.graph.showUnlinked")
            }
            testId="folio-graph-unlinked"
            pressed={!showUnlinked}
            onClick={() => {
              setShowUnlinked(!showUnlinked);
              setView(undefined);
            }}
          >
            {showUnlinked ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </FolioGraphTool>
        )}
      </div>
    </div>
  );
};

/**
 * Every label in view is drawn while the view holds at most this many
 * folios; past it, only the open folio's, the hovered one's and their
 * neighbours', or the picture is all text. Zooming in brings a dense area
 * under the limit.
 */
const ALL_LABELS_UP_TO = 40;

/**
 * The smallest extent the fitted view shows, in layout units, and the
 * margin around the graph.
 */
const MIN_SPAN = 240;
const PAD = 40;

/**
 * A dot is drawn at most this many pixels per layout unit of its radius,
 * so two folios are not blown up to fill the dialog, nor a dot when zoomed
 * in.
 */
const DOT_PIXELS_PER_UNIT = 1.1;

/**
 * How long one slice of layout may run before the page gets the thread
 * back, in milliseconds: well under a frame, so the dialog stays
 * interactive while a large graph lays out.
 */
const SLICE_MS = 8;

/**
 * The pointer travel, in pixels, past which a press is a pan, not a click.
 */
const DRAG_THRESHOLD = 4;

/**
 * Label text size, in pixels whatever the zoom, and the longest label
 * drawn for a folio that is not the focused one.
 */
const LABEL_PX = 11;
const LABEL_MAX_CHARS = 48;

interface FolioGraphView {
  /**
   * The layout point at the centre of the view.
   */
  cx: number;
  cy: number;
  /**
   * Pixels per layout unit.
   */
  scale: number;
}

/**
 * The view scaled by `factor` around a point given in pixels from the
 * view's centre, which stays where it is on screen.
 */
const zoomAround = (
  view: FolioGraphView,
  factor: number,
  px: number,
  py: number,
): FolioGraphView => {
  const scale = Math.min(20, Math.max(0.02, view.scale * factor));
  // The layout point under (px, py) before and after is the same one.
  const ux = view.cx + px / view.scale;
  const uy = view.cy + py / view.scale;
  return { cx: ux - px / scale, cy: uy - py / scale, scale };
};

interface PlaceLabelsInput {
  graph: ReturnType<typeof indexGraph>;
  layout: FolioGraphLayout;
  visible: (index: number) => boolean;
  focus?: number;
  current?: number;
  neighbours: Set<number>;
  box: { left: number; top: number; right: number; bottom: number };
  unit: number;
  dotScale: number;
}

/**
 * The labels to draw, in layout units: the focused and the open folio's
 * always, then their neighbours' (best linked first) and, when the view
 * holds few enough folios, every other one in view, each skipped when it
 * would overlap a label already placed. A label sits above its dot.
 */
const placeLabels = (input: PlaceLabelsInput) => {
  const { graph, layout, box, unit } = input;
  const inView: number[] = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    if (!input.visible(i)) continue;
    const x = layout.x[i];
    const y = layout.y[i];
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      inView.push(i);
    }
  }
  const strong = new Set<number>();
  if (input.current !== undefined) strong.add(input.current);
  if (input.focus !== undefined) strong.add(input.focus);
  const byDegree = (a: number, b: number) => graph.degree[b] - graph.degree[a];
  const candidates = [
    ...strong,
    ...[...input.neighbours].filter((i) => !strong.has(i)).sort(byDegree),
    ...(inView.length <= ALL_LABELS_UP_TO
      ? inView
          .filter((i) => !strong.has(i) && !input.neighbours.has(i))
          .sort(byDegree)
      : []),
  ];
  const placed: Array<{
    index: number;
    x: number;
    y: number;
    text: string;
    strong: boolean;
    box: [number, number, number, number];
  }> = [];
  for (const index of candidates) {
    if (!input.visible(index)) continue;
    const isStrong = strong.has(index);
    const title = graph.nodes[index].title;
    const text =
      isStrong || title.length <= LABEL_MAX_CHARS
        ? title
        : `${title.slice(0, LABEL_MAX_CHARS - 1)}…`;
    const px = (isStrong ? LABEL_PX + 1 : LABEL_PX) * unit;
    const halfWidth = (text.length * px * 0.56) / 2;
    const x = layout.x[index];
    const y =
      layout.y[index] - layout.radius[index] * input.dotScale - 4 * unit;
    const rect: [number, number, number, number] = [
      x - halfWidth,
      y - px,
      x + halfWidth,
      y + px * 0.25,
    ];
    const collides = placed.some(
      (other) =>
        rect[0] < other.box[2] &&
        rect[2] > other.box[0] &&
        rect[1] < other.box[3] &&
        rect[3] > other.box[1],
    );
    // The focused folio's label is always drawn; any other one only where
    // it has room.
    if (collides && !isStrong) continue;
    placed.push({ index, x, y, text, strong: isStrong, box: rect });
  }
  return placed;
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
