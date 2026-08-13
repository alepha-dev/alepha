import * as React from "react";

void React;

import { AdminAnalyticsQueryPanel } from "@alepha/ui/components/admin/admin-analytics-query-panel";
import { AdminAnalyticsResults } from "@alepha/ui/components/admin/admin-analytics-results";
import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import type {
  AdminAnalyticsController,
  AdminAnalyticsResult,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

/**
 * Generic analytics explorer over every `$analytics()` dataset the app
 * declares. Datasets, dimensions and measures all come from the admin API's
 * JSON-Schema descriptors — nothing here is app-specific.
 */
export function AdminAnalytics() {
  const client = useClient<AdminAnalyticsController>();
  const { tr } = useI18n();
  const [datasets, setDatasets] = useState<AdminDatasetDescriptor[]>();
  const [selected, setSelected] = useState<string>();
  const [result, setResult] = useState<AdminAnalyticsResult>();

  useEffect(() => {
    client.listDatasets().then((list) => {
      setDatasets(list);
      setSelected((current) => current ?? list[0]?.name);
    });
  }, [client]);

  const dataset = datasets?.find((d) => d.name === selected);

  return (
    <AdminPage>
      <div className="flex items-center gap-3">
        <Select
          // `?? null`, never `undefined`: an initial `undefined` mounts the
          // root uncontrolled, and the later programmatic selection no longer
          // drives the trigger. `null` is Base UI's controlled "nothing
          // selected".
          value={selected ?? null}
          // Base UI resolves the trigger label from `items`: without it, a
          // programmatically selected value renders as the placeholder until
          // the popup has been opened once, because the list items live in an
          // unmounted popup.
          items={(datasets ?? []).map((d) => ({
            value: d.name,
            label: d.name,
          }))}
          onValueChange={(name) => {
            setSelected(name ?? undefined);
            setResult(undefined);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue
              placeholder={tr("admin.analytics.pickDataset", {
                default: "Pick a dataset",
              })}
            />
          </SelectTrigger>
          <SelectContent>
            {(datasets ?? []).map((d) => (
              <SelectItem key={d.name} value={d.name}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {datasets?.length === 0 && (
          <span className="text-muted-foreground text-sm">
            {tr("admin.analytics.noDatasets", {
              default: "No analytics datasets are declared in this app.",
            })}
          </span>
        )}
      </div>
      {dataset && (
        <AdminAnalyticsQueryPanel
          key={dataset.name}
          dataset={dataset}
          onResult={setResult}
        />
      )}
      {dataset && result && (
        <AdminAnalyticsResults dataset={dataset} result={result} />
      )}
    </AdminPage>
  );
}

export default AdminAnalytics;
