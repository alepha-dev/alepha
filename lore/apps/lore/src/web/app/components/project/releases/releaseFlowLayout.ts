import type { ReleaseContentQuest } from "@/api/schemas/releaseContentQuestSchema.ts";

import {
  CARD_W,
  QuestlineLayout,
  type QuestlineTrack,
} from "../quest/questline/questlineLayout.ts";
import { questStatus } from "./releaseBuckets.ts";
import type {
  ReleaseContentsData,
  ReleaseContentsEpic,
} from "./ReleaseContents.tsx";

/**
 * Geometry shared by `ReleaseFlowCluster` and the edge layer, for the same
 * reason `questlineLayout.ts` exports its own: a box is sized here and drawn
 * there, and the connector between two boxes has to land on the box that
 * was drawn.
 */
export const CLUSTER_PAD = 16;
export const CLUSTER_HEADER = 44;
export const CLUSTER_GAP_X = 72;
export const CLUSTER_GAP_Y = 28;
/**
 * Between two questlines inside one cluster. The epic's own board uses
 * `gap-6`, so a cluster reads as that board in a frame.
 */
export const TRACK_GAP = 24;

const HANDLE_R = 5;
const ELBOW = 36;

export interface ReleaseFlowGroup {
  /**
   * Absent on the loose group: the quests in the release under no attached
   * epic.
   */
  epic?: ReleaseContentsEpic;
  tracks: QuestlineTrack<ReleaseContentQuest>[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReleaseFlowEpicGroup extends ReleaseFlowGroup {
  epic: ReleaseContentsEpic;
  /**
   * Column, 0-based: the distance from the epic forest's root.
   */
  depth: number;
  /**
   * The predecessor, when it is inside this release.
   */
  prevId?: number;
  nextIds: number[];
}

export interface ReleaseFlowMap {
  /**
   * Sorted by column, then by row.
   */
  epics: ReleaseFlowEpicGroup[];
  loose: ReleaseFlowGroup | null;
  /**
   * Elbows between clusters, in board coordinates.
   */
  edges: string[];
  width: number;
  height: number;
}

/**
 * Two nested forests, drawn as one map.
 *
 * Every attached epic is a cluster holding its own questline, laid out by
 * `QuestlineLayout` exactly as the epic's Flow tab lays it out. The clusters
 * are then placed by the same post-order walk one level up, over
 * `epics.dependsOn`: a dependent sits one column right of its predecessor, a
 * leaf takes the next free row, a predecessor centres on its dependents.
 *
 * The same algorithm and not the same function: the questline walk places
 * fixed `CARD_W` by `CARD_H` boxes on integer rows, while a cluster is as
 * tall as the questlines inside it. So rows here are real pixels, a
 * predecessor taller than the span of its dependents pushes the next
 * subtree down rather than overlapping it, and a column is as wide as the
 * widest cluster in it.
 *
 * Quest edges never cross a cluster. A quest whose predecessor lives in
 * another epic is a root of its own group and stays `waiting`, which is
 * exactly how the epic's Flow already treats a blocker outside its set.
 */
export class ReleaseFlowLayout {
  protected readonly questline = new QuestlineLayout<ReleaseContentQuest>(
    questStatus,
  );

  build(contents: ReleaseContentsData): ReleaseFlowMap {
    const groups = contents.epics.map((epic) => this.group(epic));
    const byId = new Map(groups.map((group) => [group.epic.id, group]));
    const byNumber = (a: ReleaseFlowEpicGroup, b: ReleaseFlowEpicGroup) =>
      a.epic.number - b.epic.number;

    // The forest. A predecessor outside this release orders nothing here and
    // the epic is a root, the same rule `EpicDependencyService.order` uses.
    const roots: ReleaseFlowEpicGroup[] = [];
    for (const group of groups) {
      const parent =
        group.epic.dependsOn != null
          ? byId.get(group.epic.dependsOn)
          : undefined;
      if (!parent) {
        roots.push(group);
        continue;
      }
      group.prevId = parent.epic.id;
      parent.nextIds.push(group.epic.id);
    }
    roots.sort(byNumber);
    for (const group of groups) {
      group.nextIds.sort(
        (a, b) =>
          (byId.get(a)?.epic.number ?? 0) - (byId.get(b)?.epic.number ?? 0),
      );
    }

    // Columns come from depth. A cycle has no root, so the walk never
    // reaches it and its epics would vanish: promote the lowest number still
    // unplaced, cut the edge INTO it so it is a real root, and walk again.
    // `resolve` refuses cycles on write, so this is for rows that predate it.
    const placed = new Set<number>();
    const assignDepth = (group: ReleaseFlowEpicGroup, depth: number) => {
      if (placed.has(group.epic.id)) return;
      placed.add(group.epic.id);
      group.depth = depth;
      for (const id of group.nextIds) {
        const child = byId.get(id);
        if (child) assignDepth(child, depth + 1);
      }
    };
    for (const root of roots) assignDepth(root, 0);
    for (const group of [...groups].sort(byNumber)) {
      if (placed.has(group.epic.id)) continue;
      const parent = group.prevId != null ? byId.get(group.prevId) : undefined;
      if (parent) {
        parent.nextIds = parent.nextIds.filter((id) => id !== group.epic.id);
      }
      group.prevId = undefined;
      roots.push(group);
      assignDepth(group, 0);
    }

    // The widest cluster at each depth sets that column's width.
    const columnWidth: number[] = [];
    for (const group of groups) {
      columnWidth[group.depth] = Math.max(
        columnWidth[group.depth] ?? 0,
        group.width,
      );
    }
    const columnX: number[] = [];
    let x = 0;
    for (let depth = 0; depth < columnWidth.length; depth++) {
      columnX[depth] = x;
      x += (columnWidth[depth] ?? 0) + CLUSTER_GAP_X;
    }
    for (const group of groups) group.x = columnX[group.depth] ?? 0;

    // Rows: a post-order walk in real pixels.
    let cursor = 0;
    const place = (group: ReleaseFlowEpicGroup): void => {
      const children = group.nextIds
        .map((id) => byId.get(id))
        .filter((child): child is ReleaseFlowEpicGroup => child != null);
      if (children.length === 0) {
        group.y = cursor;
        cursor += group.height + CLUSTER_GAP_Y;
        return;
      }
      const top = cursor;
      for (const child of children) place(child);
      const first = children[0]!;
      const last = children[children.length - 1]!;
      const centre = (first.y + last.y + last.height) / 2;
      // Centred on its dependents, never above the row its subtree started
      // on, and tall enough to push the next subtree past its own bottom.
      group.y = Math.max(top, centre - group.height / 2);
      cursor = Math.max(cursor, group.y + group.height + CLUSTER_GAP_Y);
    };
    for (const root of roots) place(root);

    const forestWidth = groups.length
      ? Math.max(...groups.map((group) => group.x + group.width))
      : 0;
    const forestHeight = groups.length
      ? Math.max(...groups.map((group) => group.y + group.height))
      : 0;

    // The loose quests are one group below the forest. They are in the
    // release without belonging to any of its epics, so the epic graph has
    // nothing to say about where they sit.
    let loose: ReleaseFlowGroup | null = null;
    if (contents.looseQuests.length > 0) {
      const tracks = this.questline.build(contents.looseQuests);
      const inner = this.innerSize(tracks);
      loose = {
        tracks,
        x: 0,
        y: forestHeight > 0 ? forestHeight + CLUSTER_GAP_Y : 0,
        width: inner.width + 2 * CLUSTER_PAD,
        height: inner.height + CLUSTER_HEADER + 2 * CLUSTER_PAD,
      };
    }

    return {
      epics: groups.sort((a, b) => a.depth - b.depth || a.y - b.y),
      loose,
      edges: this.edges(groups, byId),
      width: Math.max(forestWidth, loose ? loose.x + loose.width : 0),
      height: loose ? loose.y + loose.height : forestHeight,
    };
  }

  protected group(epic: ReleaseContentsEpic): ReleaseFlowEpicGroup {
    const tracks = this.questline.build(epic.quests);
    const inner = this.innerSize(tracks);
    return {
      epic,
      tracks,
      depth: 0,
      x: 0,
      y: 0,
      width: inner.width + 2 * CLUSTER_PAD,
      height: inner.height + CLUSTER_HEADER + 2 * CLUSTER_PAD,
      nextIds: [],
    };
  }

  /**
   * The questlines stacked, widest one across. An epic with no quests still
   * gets a box the width of one card, so its header has room to say what it
   * is.
   */
  protected innerSize(tracks: QuestlineTrack<ReleaseContentQuest>[]): {
    width: number;
    height: number;
  } {
    if (tracks.length === 0) return { width: CARD_W, height: 0 };
    return {
      width: Math.max(...tracks.map((track) => track.width)),
      height:
        tracks.reduce((sum, track) => sum + track.height, 0) +
        (tracks.length - 1) * TRACK_GAP,
    };
  }

  /**
   * One elbow per predecessor, from the middle of its right edge to the
   * middle of each dependent's left edge, turning inside the column gap. The
   * questline's own connectors, one level up; a straight line only when the
   * two middles are already level.
   */
  protected edges(
    groups: ReleaseFlowEpicGroup[],
    byId: Map<number, ReleaseFlowEpicGroup>,
  ): string[] {
    const paths: string[] = [];
    for (const parent of groups) {
      const children = parent.nextIds
        .map((id) => byId.get(id))
        .filter((child): child is ReleaseFlowEpicGroup => child != null);
      if (children.length === 0) continue;

      const fromX = parent.x + parent.width + HANDLE_R;
      const fromY = parent.y + parent.height / 2;
      // Every dependent sits in the column after its predecessor's.
      const toX = children[0]!.x - HANDLE_R;
      const ys = children.map((child) => child.y + child.height / 2);

      if (children.length === 1 && ys[0] === fromY) {
        paths.push(`M${fromX} ${fromY} H${toX}`);
        continue;
      }
      const turn = parent.x + parent.width + ELBOW;
      paths.push(`M${fromX} ${fromY} H${turn}`);
      paths.push(
        `M${turn} ${Math.min(fromY, ...ys)} V${Math.max(fromY, ...ys)}`,
      );
      for (const y of ys) paths.push(`M${turn} ${y} H${toX}`);
    }
    return paths;
  }
}
