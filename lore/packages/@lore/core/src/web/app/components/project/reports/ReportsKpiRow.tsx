import ReportsDefinition from "./ReportsDefinition.tsx";
import ReportsKpiDelta, {
  type ReportsKpiDeltaProps,
} from "./ReportsKpiDelta.tsx";

export interface ReportsKpi {
  label: string;
  value: string | number;
  /**
   * What the figure counts, behind an info mark.
   */
  definition: string;
  /**
   * Optional secondary line, e.g. "+3 vs last week".
   */
  hint?: string;
  delta?: ReportsKpiDeltaProps["delta"];
}

export interface ReportsKpiRowProps {
  kpis: ReportsKpi[];
}

/**
 * Flat KPI number-row — big figures, no cards.
 */
const ReportsKpiRow = (props: ReportsKpiRowProps) => {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {props.kpis.map((kpi) => (
        <div key={kpi.label} className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold tabular-nums">{kpi.value}</span>
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            {kpi.label}
            <ReportsDefinition text={kpi.definition} />
          </span>
          {kpi.hint ? (
            <span className="text-muted-foreground/70 text-xs">{kpi.hint}</span>
          ) : null}
          {kpi.delta ? <ReportsKpiDelta delta={kpi.delta} /> : null}
        </div>
      ))}
    </div>
  );
};

export default ReportsKpiRow;
