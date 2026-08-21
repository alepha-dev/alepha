import { useRouter } from "alepha/react/router";
import {
  Archive,
  ArrowUpRight,
  Atom,
  Boxes,
  Clock,
  HardDrive,
  Radio,
  ShieldCheck,
  Table2,
  Terminal,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";

import type { DevMetadata } from "../../../schemas/DevMetadata.ts";

export interface DashboardPrimitivesProps {
  metadata?: DevMetadata;
}

interface PrimitiveTile {
  label: string;
  count: number;
  icon: ComponentType<{ size?: number }>;
  /**
   * Each primitive gets its own colour, kept consistent with the rail and nav
   * so the icon alone identifies the kind.
   */
  tone: string;
  href: string;
}

/**
 * Counts of everything the application declares, each a way in.
 *
 * A tile with a zero count is dropped rather than shown greyed out: on this
 * screen the question is "what is in this app", and a row of zeros answers it
 * with noise.
 */
export const DashboardPrimitives = (props: DashboardPrimitivesProps) => {
  const router = useRouter();
  const d = props.metadata;

  const tiles: PrimitiveTile[] = d
    ? [
        {
          label: "Actions",
          count: d.actions?.length ?? 0,
          icon: Zap,
          tone: "var(--dt-get)",
          href: "/actions",
        },
        {
          label: "Pages",
          count: d.pages?.length ?? 0,
          icon: Archive,
          tone: "var(--dt-info)",
          href: "/pages",
        },
        {
          label: "Jobs",
          count: d.jobs?.length ?? 0,
          icon: Clock,
          tone: "var(--dt-patch)",
          href: "/jobs",
        },
        {
          label: "Entities",
          count: d.entities?.length ?? 0,
          icon: Table2,
          tone: "#5eead4",
          href: "/schema",
        },
        {
          label: "Topics",
          count: d.topics?.length ?? 0,
          icon: Radio,
          tone: "#c084fc",
          href: "/topics",
        },
        {
          label: "Caches",
          count: d.caches?.length ?? 0,
          icon: Boxes,
          tone: "var(--dt-put)",
          href: "/caches",
        },
        {
          label: "Storage",
          count: d.storages?.length ?? 0,
          icon: HardDrive,
          tone: "#38bdf8",
          href: "/storage",
        },
        {
          label: "Realms",
          count: d.realms?.length ?? 0,
          icon: ShieldCheck,
          tone: "#a3e635",
          href: "/realms",
        },
        {
          label: "Atoms",
          count: d.atoms?.length ?? 0,
          icon: Atom,
          tone: "#f472b6",
          href: "/atoms",
        },
        {
          label: "Env",
          count: new Set(
            (d.envs ?? []).flatMap((env) =>
              Object.keys(env.schema?.properties ?? {}),
            ),
          ).size,
          icon: Terminal,
          tone: "var(--dt-fg-dim)",
          href: "/env",
        },
      ].filter((tile) => tile.count > 0)
    : [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        border: "1px solid var(--dt-border)",
        background: "var(--dt-panel)",
        marginBottom: 22,
      }}
    >
      {tiles.map((tile) => (
        <button
          key={tile.label}
          type="button"
          className="dt-tile"
          onClick={() => router.push(tile.href)}
        >
          <span className="dt-tile-head">
            <span style={{ color: tile.tone, display: "inline-flex" }}>
              <tile.icon size={12} />
            </span>
            {tile.label}
          </span>
          <span className="dt-tile-value dt-mono">
            {tile.count}
            <ArrowUpRight size={11} className="dt-tile-go" />
          </span>
        </button>
      ))}
    </div>
  );
};
