import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

/**
 * Geometry shared by the renderer and its edge layer. Every number here is
 * consumed twice: once to place a card in the row, once to draw the
 * connector that has to land exactly on that card's handle. They live
 * together so the two can never drift apart.
 */
export const CARD_W = 272;
export const CARD_H = 104;
export const COL_GAP = 44;
export const ROW_GAP = 22;

/** Half a handle, so a connector stops at the dot rather than under it. */
const HANDLE_R = 5;
/** Where a fork turns from horizontal to vertical, inside the column gap. */
const ELBOW = 32;

export type QuestlineState =
  | "done"
  | "running"
  | "ready"
  | "waiting"
  | "shelved";

export interface QuestlineNode {
  quest: QuestResource;
  state: QuestlineState;
  /** Column, 0-based: the distance from this questline's root. */
  depth: number;
  x: number;
  y: number;
  /** The single predecessor, when it is inside this set. */
  prevId?: number;
  /** Dependents inside this set. Several means a fork. */
  nextIds: number[];
}

export interface QuestlineTrack {
  rootId: number;
  nodes: QuestlineNode[];
  /** Elbow paths, in the track's own coordinate space. */
  edges: string[];
  width: number;
  height: number;
}

/**
 * Turn a set of quests into the forest it actually describes.
 *
 * `quests.dependsOn` is a single optional FK, so a quest has at most one
 * predecessor and the relation is a forest of trees, never a general DAG.
 * That is the whole reason this file exists instead of a layout library:
 * laying out a tree is a walk, and a walk is sixty lines.
 *
 * A quest whose `dependsOn` points OUTSIDE the given set is laid out as a
 * root, but it is never called ready: its blocker is real, we just cannot
 * see it from here, and "ready" would be a claim the data does not support.
 */
export class QuestlineLayout {
  build(quests: QuestResource[]): QuestlineTrack[] {
    const byId = new Map(quests.map((q) => [q.id, q]));
    const childrenOf = new Map<number, number[]>();
    const roots: QuestResource[] = [];

    for (const quest of quests) {
      const parent =
        quest.dependsOn != null ? byId.get(quest.dependsOn) : undefined;
      if (!parent) {
        roots.push(quest);
        continue;
      }
      const list = childrenOf.get(parent.id) ?? [];
      list.push(quest.id);
      childrenOf.set(parent.id, list);
    }
    for (const list of childrenOf.values()) {
      list.sort(
        (a, b) => (byId.get(a)?.shortId ?? 0) - (byId.get(b)?.shortId ?? 0),
      );
    }
    roots.sort((a, b) => a.shortId - b.shortId);

    const tracks: QuestlineTrack[] = [];
    const covered = new Set<number>();
    const collect = (root: QuestResource) => {
      const track = this.track(root, byId, childrenOf);
      if (track.nodes.length === 0) return;
      for (const node of track.nodes) covered.add(node.quest.id);
      tracks.push(track);
    };
    for (const root of roots) collect(root);

    // A `dependsOn` cycle has no root, so the walk above never reached it and
    // those quests would silently vanish from the board. Promote the lowest
    // shortId still uncovered and walk again; `track` breaks the cycle itself.
    for (const quest of [...quests].sort((a, b) => a.shortId - b.shortId)) {
      if (!covered.has(quest.id)) collect(quest);
    }

    // Deepest questline first, then by root shortId. Both are derived from
    // the data, so the order is stable across reloads.
    return tracks.sort(
      (a, b) =>
        this.depthOf(b) - this.depthOf(a) ||
        (byId.get(a.rootId)?.shortId ?? 0) - (byId.get(b.rootId)?.shortId ?? 0),
    );
  }

  protected depthOf(track: QuestlineTrack): number {
    return track.nodes.reduce((max, node) => Math.max(max, node.depth), 0) + 1;
  }

  /**
   * Lay one tree out left to right. Rows come from a post-order walk: a
   * leaf takes the next free row and a parent centres on its children, so a
   * linear chain, which is the common shape, puts every node on row 0.
   */
  protected track(
    root: QuestResource,
    byId: Map<number, QuestResource>,
    childrenOf: Map<number, number[]>,
  ): QuestlineTrack {
    const nodes: QuestlineNode[] = [];
    const rowOf = new Map<number, number>();
    // A corrupt dependsOn cycle would otherwise recurse forever.
    const seen = new Set<number>();
    let nextRow = 0;

    const walk = (id: number, depth: number): number => {
      if (seen.has(id)) return nextRow;
      seen.add(id);
      const quest = byId.get(id);
      if (!quest) return nextRow;

      const children = (childrenOf.get(id) ?? []).filter(
        (child) => !seen.has(child),
      );
      let row: number;
      if (children.length === 0) {
        row = nextRow++;
      } else {
        const rows = children.map((child) => walk(child, depth + 1));
        row = (rows[0]! + rows[rows.length - 1]!) / 2;
      }
      rowOf.set(id, row);
      nodes.push({
        quest,
        state: this.stateOf(quest, byId),
        depth,
        x: depth * (CARD_W + COL_GAP),
        y: 0, // filled in below, once every row is known
        prevId:
          quest.dependsOn != null && byId.has(quest.dependsOn)
            ? quest.dependsOn
            : undefined,
        nextIds: childrenOf.get(id) ?? [],
      });
      return row;
    };
    walk(root.id, 0);

    for (const node of nodes) {
      node.y = (rowOf.get(node.quest.id) ?? 0) * (CARD_H + ROW_GAP);
    }

    return {
      rootId: root.id,
      nodes: nodes.sort((a, b) => a.depth - b.depth || a.y - b.y),
      edges: this.edges(nodes),
      width: Math.max(...nodes.map((node) => node.x)) + CARD_W,
      height: Math.max(...nodes.map((node) => node.y)) + CARD_H,
    };
  }

  /**
   * One elbow per parent. A single child is a straight line; several turn a
   * corner inside the column gap and fan out vertically from it.
   */
  protected edges(nodes: QuestlineNode[]): string[] {
    const byId = new Map(nodes.map((node) => [node.quest.id, node]));
    const paths: string[] = [];

    for (const parent of nodes) {
      const children = parent.nextIds
        .map((id) => byId.get(id))
        .filter((node): node is QuestlineNode => node != null);
      if (children.length === 0) continue;

      const fromX = parent.x + CARD_W + HANDLE_R;
      const fromY = parent.y + CARD_H / 2;
      const toX = children[0]!.x - HANDLE_R;

      if (children.length === 1) {
        paths.push(`M${fromX} ${fromY} H${toX}`);
        continue;
      }
      const turn = parent.x + CARD_W + ELBOW;
      const ys = children.map((child) => child.y + CARD_H / 2);
      paths.push(`M${fromX} ${fromY} H${turn}`);
      paths.push(`M${turn} ${Math.min(...ys)} V${Math.max(...ys)}`);
      for (const y of ys) paths.push(`M${turn} ${y} H${toX}`);
    }
    return paths;
  }

  /**
   * Five states, and only one of them needs the graph: a quest is ready
   * when nothing stands in front of it, which is a fact about its
   * predecessor rather than about itself.
   */
  protected stateOf(
    quest: QuestResource,
    byId: Map<number, QuestResource>,
  ): QuestlineState {
    const status = quest.metadata.status;
    if (status === "completed") return "done";
    if (status === "accepted") return "running";
    if (status === "shelved") return "shelved";
    if (quest.dependsOn == null) return "ready";
    const parent = byId.get(quest.dependsOn);
    // Outside this set: the blocker exists, we just cannot see it.
    if (!parent) return "waiting";
    return parent.metadata.status === "completed" ? "ready" : "waiting";
  }
}
