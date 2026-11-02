import { Control, ControlDateRange } from "@alepha/ui/form";
import { z } from "alepha";
import { useInject, useStore } from "alepha/react";
import { type BaseInputField, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";

import type { ReportsUrl } from "../../../../../api/schemas/reportsUrlSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { ReportsTabRegistry } from "../../../registries/ReportsTabRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import { hasCapability } from "../../../services/projectCapabilities.ts";
import { ReportsUrlQuery } from "../../../services/ReportsUrlQuery.ts";
import ReportsFilterSelect from "./ReportsFilterSelect.tsx";

export interface ReportsFilterBarProps {
  /**
   * The page query, decoded as `reportsUrlSchema`.
   */
  url: ReportsUrl;
}

/**
 * The filter bar above the Reports tabs (#Q2996): period, grain, compare and
 * Work filters, kept in the page query.
 *
 * ⚠️ **It writes on change, and only on change.** A bar that wrote a missing
 * param back from an effect is #156: `useRouterState` is a global store, so
 * the outgoing render of a navigation sees the next route's empty query and
 * bounces the user back. The default period is therefore applied where the
 * URL is read, never written into it, and `ReportsLayout` keys this component
 * on the query so back and forward re-seed the form.
 *
 * A filter the active tab does not declare stays visible and disabled, so the
 * bar holds still between tabs and says what does not apply here.
 */
const ReportsFilterBar = (props: ReportsFilterBarProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const registry = useInject(ReportsTabRegistry);
  const reportsUrl = useInject(ReportsUrlQuery);

  const route = routerState.name ?? "";
  const honoured = registry.honours(route);
  const off = (key: Parameters<typeof reportsUrl.toQuery>[1][number]) =>
    !honoured.includes(key);

  const filters = registry
    .filters()
    .filter((filter) => !filter.needs || hasCapability(project, filter.needs));

  const form = useForm({
    schema: z.object({
      range: z.text().optional(),
      dates: z.dateRange().optional(),
      grain: z.text().optional(),
      compare: z.boolean().optional(),
      ...Object.fromEntries(
        filters.map((filter) => [filter.key, z.text().optional()]),
      ),
    }),
    initialValues: {
      range: props.url.range ?? reportsUrl.defaultRange,
      dates:
        props.url.from && props.url.to
          ? [props.url.from, props.url.to]
          : undefined,
      grain: props.url.grain,
      compare: props.url.compare === "true",
      ...Object.fromEntries(
        filters.map((filter) => [filter.key, props.url[filter.key]]),
      ),
    },
    // Nothing is submitted: picking a value IS the write.
    keepDirty: false,
    handler: async () => {},
    onChange: (key, value) => {
      void router.push(route, {
        query: reportsUrl.patch(
          props.url,
          key as keyof ReportsUrl | "dates",
          value as Parameters<typeof reportsUrl.patch>[2],
        ),
      });
    },
  });

  const inputs = form.input as unknown as Record<string, BaseInputField>;

  return (
    <div
      className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-2"
      data-testid="reports-filter-bar"
    >
      <Control
        input={inputs.range!}
        label=""
        inputProps={{ "aria-label": tr("reports.filter.period") }}
        minimal
        size="xs"
        triggerClassName="w-auto"
        disabled={off("period")}
        items={[
          ...reportsUrl.presets.map((value) => ({
            value,
            label: tr(`reports.filter.range.${value}`),
          })),
          { value: "custom", label: tr("reports.filter.range.custom") },
        ]}
      />
      {props.url.range === "custom" ||
      inputs.range?.props.value === "custom" ? (
        <ControlDateRange
          input={inputs.dates!}
          disabled={off("period")}
          clearable
          triggerClassName="w-auto"
        />
      ) : null}
      <Control
        input={inputs.grain!}
        label=""
        inputProps={{ "aria-label": tr("reports.filter.grain") }}
        placeholder={tr("reports.filter.grain")}
        clearable
        minimal
        size="xs"
        triggerClassName="w-auto"
        disabled={off("grain")}
        items={(["day", "week", "month"] as const).map((value) => ({
          value,
          label: tr(`reports.filter.grain.${value}`),
        }))}
      />
      <div className="flex items-center gap-1.5 text-xs">
        <Control
          input={inputs.compare!}
          label=""
          inputProps={{ "aria-label": tr("reports.filter.compare") }}
          disabled={off("compare")}
        />
        <span className="text-muted-foreground">
          {tr("reports.filter.compare")}
        </span>
      </div>
      {filters.map((filter) => (
        <ReportsFilterSelect
          key={filter.key}
          filter={filter}
          input={inputs[filter.key]!}
          disabled={off(filter.key)}
        />
      ))}
    </div>
  );
};

export default ReportsFilterBar;
