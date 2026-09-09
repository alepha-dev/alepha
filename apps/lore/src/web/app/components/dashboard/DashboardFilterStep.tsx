import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";

import type { DashboardMetricDescriptor } from "@/api/services/DashboardMetricCatalog.ts";

import type { I18n } from "../../services/I18n.ts";
import { dashboardFilterFields } from "./dashboardFilterFields.ts";

export interface DashboardFilterStepProps {
  metric: DashboardMetricDescriptor;
  values: Record<string, unknown>;
  /**
   * The project's own quest tags, for a field the metric declared as
   * `projectTags`. Absent on home, which has no single project to ask.
   */
  projectTags?: string[];
  onChange: (values: Record<string, unknown>) => void;
}

/**
 * Step three: the metric's own filters, rendered from its own Zod schema.
 *
 * Nothing here knows what a status or a period is. `dashboardFilterFields`
 * reads the shape off the schema and this renders a chip per option, so a
 * metric added tomorrow gets its filter step for free.
 *
 * A field the reader cannot make wrong: a multi-valued field refuses to drop
 * its last option, because the metric's schema requires at least one and a
 * card filtered to nothing is a card that counts nothing.
 */
const DashboardFilterStep = (props: DashboardFilterStepProps) => {
  const { tr } = useI18n<I18n, "en">();
  const fields = dashboardFilterFields(
    props.metric.filters,
    props.metric.filterSources,
  );

  /**
   * A field's options: the schema's own, or the project's rows.
   *
   * ⚠️ Read off `field.source` rather than off the metric's key. This file
   * names no metric, which is the property the panel's docblock asks for and
   * which the beacon rule used to break by testing
   * `metric.key === "uniqueVisitors"`.
   */
  const optionsOf = (field: (typeof fields)[number]): string[] =>
    field.source === "projectTags" ? (props.projectTags ?? []) : field.options;

  const toggle = (name: string, option: string, multiple: boolean) => {
    if (!multiple) {
      props.onChange({ ...props.values, [name]: option });
      return;
    }
    const current = (props.values[name] as string[]) ?? [];
    const next = current.includes(option)
      ? current.filter((value) => value !== option)
      : [...current, option];
    if (next.length === 0) return;
    props.onChange({ ...props.values, [name]: next });
  };

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1.5">
          <div className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.08em] uppercase">
            {tr(`dashboard.filterField.${field.name}` as never)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {optionsOf(field).map((option) => {
              const value = props.values[field.name];
              const on = field.multiple
                ? ((value as string[]) ?? []).includes(option)
                : value === option;
              return (
                <button
                  key={option}
                  type="button"
                  data-testid="dashboard-filter-option"
                  onClick={() => toggle(field.name, option, field.multiple)}
                  className={cn(
                    "h-7 rounded-full px-3 text-[11.5px] transition-colors",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {field.source
                    ? option
                    : tr(`dashboard.filterValue.${option}` as never)}
                </button>
              );
            })}
            {optionsOf(field).length === 0 && (
              <div className="text-muted-foreground rounded-[9px] border border-dashed px-2.5 py-3 text-[11.5px]">
                {tr("dashboard.filter.noTags")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DashboardFilterStep;
