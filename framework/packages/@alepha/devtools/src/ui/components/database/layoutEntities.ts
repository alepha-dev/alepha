export type ErdLayout = "hierarchical" | "grid" | "circular";

export interface ErdBox {
  id: string;
  width: number;
  height: number;
}

export interface ErdRelation {
  from: string;
  to: string;
}

const COL_GAP = 70;
const ROW_GAP = 34;

/**
 * Position ERD tables, honouring each node's real height.
 *
 * The provider graph's `applyDagreLayout` assumes uniform 180×60 boxes, so
 * tall tables overlapped and every rank collapsed into one row. Entity nodes
 * vary from ~50px to ~600px tall, which makes height-aware packing the whole
 * problem.
 */
export const layoutEntities = (
  boxes: ErdBox[],
  relations: ErdRelation[],
  layout: ErdLayout,
): Record<string, { x: number; y: number }> => {
  const positions: Record<string, { x: number; y: number }> = {};
  if (boxes.length === 0) return positions;

  if (layout === "circular") {
    const radius = Math.max(320, boxes.length * 42);
    boxes.forEach((box, i) => {
      const angle = (i / boxes.length) * Math.PI * 2;
      positions[box.id] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    });
    return positions;
  }

  if (layout === "grid") {
    const cols = Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
    const columnY = Array.from({ length: cols }, () => 0);
    const columnX = Array.from({ length: cols }, () => 0);
    let x = 0;
    for (let c = 0; c < cols; c++) {
      columnX[c] = x;
      const widest = boxes
        .filter((_, i) => i % cols === c)
        .reduce((m, b) => Math.max(m, b.width), 200);
      x += widest + COL_GAP;
    }
    boxes.forEach((box, i) => {
      const c = i % cols;
      positions[box.id] = { x: columnX[c], y: columnY[c] };
      columnY[c] += box.height + ROW_GAP;
    });
    return positions;
  }

  // Hierarchical: depth = longest chain of outgoing foreign keys, so tables
  // nothing points at land on the left and dependents flow rightward.
  const outgoing = new Map<string, string[]>();
  for (const box of boxes) outgoing.set(box.id, []);
  for (const r of relations) {
    if (outgoing.has(r.from) && outgoing.has(r.to) && r.from !== r.to) {
      outgoing.get(r.from)!.push(r.to);
    }
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    // Cycles are normal in a schema; treat the back-edge as depth 0.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const next of outgoing.get(id) ?? []) {
      best = Math.max(best, resolve(next) + 1);
    }
    visiting.delete(id);
    depth.set(id, best);
    return best;
  };
  for (const box of boxes) resolve(box.id);

  const byDepth = new Map<number, ErdBox[]>();
  for (const box of boxes) {
    const d = depth.get(box.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(box);
  }

  // A schema is wide and shallow: most tables share a depth, so one column per
  // level puts 20 tables in a single vertical strip and the fit-zoom shrinks
  // to nothing. Each level wraps into sub-columns once it exceeds this height,
  // which keeps the drawing roughly square and legible.
  const MAX_COLUMN_H = 1600;

  const levels = Array.from(byDepth.keys()).sort((a, b) => b - a);
  let x = 0;
  for (const level of levels) {
    const boxesAtLevel = byDepth.get(level)!;
    const widest = boxesAtLevel.reduce((m, b) => Math.max(m, b.width), 200);
    let y = 0;
    let subColumnX = x;

    for (const box of boxesAtLevel) {
      if (y > 0 && y + box.height > MAX_COLUMN_H) {
        subColumnX += widest + COL_GAP;
        y = 0;
      }
      positions[box.id] = { x: subColumnX, y };
      y += box.height + ROW_GAP;
    }

    x = subColumnX + widest + COL_GAP;
  }

  return positions;
};
