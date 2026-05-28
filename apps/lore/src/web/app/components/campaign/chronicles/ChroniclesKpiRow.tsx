export interface ChroniclesKpi {
  label: string;
  value: string | number;
  /** Optional secondary line, e.g. "+3 vs last week". */
  hint?: string;
}

export interface ChroniclesKpiRowProps {
  kpis: ChroniclesKpi[];
}

/**
 * Flat KPI number-row — big figures, no cards.
 */
const ChroniclesKpiRow = (props: ChroniclesKpiRowProps) => {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {props.kpis.map((kpi) => (
        <div key={kpi.label} className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold tabular-nums">{kpi.value}</span>
          <span className="text-xs text-muted-foreground">{kpi.label}</span>
          {kpi.hint ? (
            <span className="text-xs text-muted-foreground/70">{kpi.hint}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
};

export default ChroniclesKpiRow;
