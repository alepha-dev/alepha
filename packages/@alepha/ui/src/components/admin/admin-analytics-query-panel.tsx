import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { jsonSchemaToZod, type ZObject, z } from "alepha";
import type {
  AdminAnalyticsController,
  AdminAnalyticsResult,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

export interface AdminAnalyticsQueryPanelProps {
  dataset: AdminDatasetDescriptor;
  onResult: (result: AdminAnalyticsResult) => void;
}

/**
 * The schema-driven half of the analytics explorer: dimension filters are a
 * zod form rebuilt from the dataset's published JSON Schema
 * (`jsonSchemaToZod`, the same round-trip the parameters admin uses), group-by
 * is the declared dimensions plus the `day` / `hour` pseudo-dimensions, and
 * every measure is summed — the only aggregate the query language has.
 */
export function AdminAnalyticsQueryPanel(props: AdminAnalyticsQueryPanelProps) {
  const client = useClient<AdminAnalyticsController>();
  const alepha = useAlepha();
  const { tr } = useI18n();

  const dimensionNames = Object.keys(props.dataset.dimensions.properties ?? {});
  const measureNames = Object.keys(props.dataset.measures.properties ?? {});

  const defaultSince = useMemo(() => {
    const dateTime = alepha.inject(DateTimeProvider);
    return new Date(dateTime.nowMillis() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }, [alepha]);

  const [since, setSince] = useState(defaultSince);
  const [groupBy, setGroupBy] = useState<string[]>(["day"]);

  const filterSchema = useMemo(() => {
    const shape: Record<string, any> = {};
    for (const name of dimensionNames) {
      const property = (props.dataset.dimensions.properties ?? {})[name];
      shape[name] = (jsonSchemaToZod(property) as any).optional();
    }
    return z.object(shape) as ZObject;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dataset]);

  const form = useForm(
    {
      schema: filterSchema,
      handler: async (values: Record<string, unknown>) => {
        const where: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(values)) {
          if (value !== undefined && value !== "" && value !== null) {
            where[key] = value as string | number;
          }
        }
        const result = await client.queryDataset({
          params: { name: props.dataset.name },
          body: {
            since,
            where: Object.keys(where).length > 0 ? where : undefined,
            groupBy: groupBy.length > 0 ? groupBy : undefined,
            select: Object.fromEntries(
              measureNames.map((measure) => [measure, "sum" as const]),
            ),
            limit: 200,
          },
        });
        props.onResult(result);
      },
    },
    [props.dataset.name],
  );

  const toggleGroupBy = (name: string) => {
    setGroupBy((current) =>
      current.includes(name)
        ? current.filter((g) => g !== name)
        : [...current, name],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-analytics-since">
            {tr("admin.analytics.since", { default: "Since (UTC day)" })}
          </Label>
          <Input
            id="admin-analytics-since"
            className="w-40"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>
            {tr("admin.analytics.groupBy", { default: "Group by" })}
          </Label>
          <div className="flex h-9 flex-wrap items-center gap-3">
            {[...dimensionNames, "day", "hour"].map((name) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <Checkbox
                  checked={groupBy.includes(name)}
                  onCheckedChange={() => toggleGroupBy(name)}
                />
                {name}
              </label>
            ))}
          </div>
        </div>
        <div className="flex h-9 items-center gap-1.5">
          {measureNames.map((measure) => (
            <Badge key={measure} variant="secondary">
              sum({measure})
            </Badge>
          ))}
        </div>
      </div>
      <AutoForm
        form={form}
        title={tr("admin.analytics.filters", { default: "Filters" })}
        submitLabel={tr("admin.analytics.run", { default: "Run query" })}
        skipReset
      />
    </div>
  );
}

export default AdminAnalyticsQueryPanel;
