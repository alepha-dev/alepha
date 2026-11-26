import { AccountPage } from "@alepha/ui/account";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm, useFormQuerySync, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";

import { hostStatsRangeSchema } from "../../../../api/schemas/hostStatsRangeSchema.ts";
import type { I18n } from "../../services/I18n.ts";
import BayStatsChart from "./BayStatsChart.client.tsx";

/**
 * A host's Stats tab (#Q4528): CPU, memory and disk over the range picked
 * above the chart, the last hour, today, the last 7 days or the last 30,
 * kept in the address as `?range=` so a link opens the same window. It was
 * the bottom of the Overview, fixed at 30 days.
 */
const BayStats = () => {
  const { tr } = useI18n<I18n, "en">();
  const state = useRouterState();
  const asked = hostStatsRangeSchema.safeParse(state.query?.range);
  const form = useForm(
    {
      schema: z.object({ range: hostStatsRangeSchema }),
      initialValues: { range: asked.success ? asked.data : "month" },
      handler: () => {},
    },
    [],
  );
  useFormQuerySync(form, { keys: ["range"] });
  const values = useFormValues(form);
  const parsed = hostStatsRangeSchema.safeParse(values.range);
  const range = parsed.success ? parsed.data : "month";

  return (
    <AccountPage variant="form" className="max-w-5xl gap-4">
      <div data-testid="bay-stats-range">
        <Control
          segmented
          input={form.input.range}
          label={tr("bay.stats.range")}
          items={hostStatsRangeSchema.options.map((value) => ({
            value,
            label: tr(`bay.stats.range.${value}`),
          }))}
        />
      </div>
      <BayStatsChart range={range} />
    </AccountPage>
  );
};

export default BayStats;
