import { useI18n } from "alepha/react/i18n";

export interface PlaqueSpecProps {
  /**
   * Descriptive spec copy, as seeded in the product's `config`.
   */
  spec: {
    titre?: string;
    metal?: string;
    poids?: string;
    dimensions?: string;
  };
  /**
   * Product slug, shown as the atelier's own reference.
   */
  reference: string;
  /**
   * `list` is compact for a catalogue row; `detail` opens it out.
   */
  variant?: "list" | "detail";
}

/**
 * The spec plate: what the object *is*, as measurements.
 *
 * A jeweller describes a piece by its metal, its fineness, its weight and its
 * dimensions before describing how it looks — those are the facts a buyer
 * compares and an assay office checks. Presenting them as a stamped data block
 * rather than prose is the structural device that makes the catalogue read as a
 * workbook, and every field in it is real information rather than a label
 * invented to fill the grid.
 */
export const PlaqueSpec = (props: PlaqueSpecProps) => {
  const { spec, reference, variant = "list" } = props;
  const { tr } = useI18n();

  const rows = [
    [tr("spec.metal"), spec.metal],
    // Only a numeric fineness takes the per-mille sign: a gift card's titre is
    // "—", and "— ‰" is nonsense.
    [
      tr("spec.titre"),
      spec.titre && /^\d+$/.test(spec.titre) ? `${spec.titre} ‰` : spec.titre,
    ],
    [tr("spec.poids"), spec.poids],
    [tr("spec.dimensions"), spec.dimensions],
    [tr("spec.reference"), reference.toUpperCase()],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (variant === "list") {
    // One line, separated by scribed pipes — enough to compare rows at a glance.
    return (
      <dl className="mesure text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        {rows.slice(0, 3).map(([label, value]) => (
          <div key={label} className="flex gap-1.5">
            <dt className="sr-only">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="trait mesure grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pt-4">
      {rows.map(([label, value]) => (
        <div key={label} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
};
