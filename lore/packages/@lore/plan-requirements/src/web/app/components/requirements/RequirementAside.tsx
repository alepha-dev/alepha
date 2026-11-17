import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import {
  canInProject,
  currentProjectAtom,
  formatReference,
  type I18n,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import { REQUIREMENT_TYPE_LABEL_KEYS } from "./requirementLabels.ts";
import RequirementPriorityBadge from "./RequirementPriorityBadge.tsx";
import RequirementReleaseControl from "./RequirementReleaseControl.tsx";
import RequirementStatusChips from "./RequirementStatusChips.tsx";

export interface RequirementAsideProps {
  requirement: RequirementResource;
  releases: Array<{ id: number; tag?: string; title?: string }>;
  onChange: (requirement: RequirementResource) => void;
}

/**
 * A requirement's identity card (#E153): reference, statement, status, type
 * and priority, chapter, source, the personas concerned (through the use
 * cases) and its Target release, a control. A row with nothing to say is
 * omitted.
 */
const RequirementAside = (props: RequirementAsideProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const [project] = useStore(currentProjectAtom);
  const it = props.requirement;
  const canWrite = !!project && canInProject(project, "requirement:write");

  const rows: DetailAsideRow[] = [
    {
      label: tr("requirements.persona.aside.id"),
      copy: formatReference("requirement", it.number),
    },
    {
      label: tr("requirements.requirement.field.statement"),
      value: (
        <span className="text-sm font-medium break-words">{it.statement}</span>
      ),
    },
    {
      label: tr("requirements.requirement.col.status"),
      value: <RequirementStatusChips requirement={it} />,
    },
    {
      label: tr("requirements.requirement.field.type"),
      value: (
        <span className="text-sm">
          {tr(REQUIREMENT_TYPE_LABEL_KEYS[it.type])}
        </span>
      ),
    },
    {
      label: tr("requirements.requirement.field.priority"),
      value: <RequirementPriorityBadge priority={it.priority} />,
    },
    ...(it.chapter || it.paragraph
      ? [
          {
            label: tr("requirements.requirement.field.chapter"),
            value: (
              <span className="text-sm">
                {[it.chapter, it.paragraph ? `§${it.paragraph}` : undefined]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ),
          },
        ]
      : []),
    ...(it.sourceFolioId
      ? [
          {
            label: tr("requirements.requirement.field.source"),
            value: (
              <span className="text-sm">
                {it.sourceAnchor
                  ? `#${it.sourceAnchor}`
                  : tr("requirements.requirement.source.whole")}
              </span>
            ),
          },
        ]
      : []),
    ...(it.personas.length
      ? [
          {
            label: tr("requirements.requirement.field.personas"),
            value: (
              <ul className="flex flex-col gap-0.5 text-sm">
                {it.personas.map((p) => (
                  <li key={p.number}>
                    <ReferenceLink kind="persona" number={p.number}>
                      {p.name}
                    </ReferenceLink>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    {
      label: tr("requirements.requirement.release"),
      value: (
        <RequirementReleaseControl
          requirement={it}
          releases={props.releases}
          disabled={!canWrite}
          onChange={props.onChange}
        />
      ),
    },
    {
      label: tr("requirements.persona.aside.created"),
      value: (
        <span className="text-sm">{i18n.l(it.createdAt, { date: "ll" })}</span>
      ),
    },
  ];

  // No title and no avatar, as an epic's aside: the statement is a row, and
  // a requirement has no picture.
  return <DetailAside avatar={false} rows={rows} />;
};

export default RequirementAside;
