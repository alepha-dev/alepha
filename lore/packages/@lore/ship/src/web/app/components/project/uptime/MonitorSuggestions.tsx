import { Button } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { appUrl, appUrlLabel } from "../apps/appUrl.ts";

export interface MonitorSuggestionsProps {
  /**
   * The project's app instances that have an address and no monitor yet.
   */
  instances: AppInstanceResource[];
  busy: boolean;
  onAdd: (instance: AppInstanceResource) => void;
}

/**
 * The project's own apps offered as monitors in one click (#Q2680).
 *
 * The project already knows what it deploys and where, so typing a name and a
 * URL the Apps list holds is the step this removes. Each button opens the same
 * Add monitor dialog, prefilled, rather than creating anything on its own: the
 * interval and alerting defaults are still a choice somebody makes.
 */
const MonitorSuggestions = (props: MonitorSuggestionsProps) => {
  const { tr } = useI18n<I18n, "en">();

  if (props.instances.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="uptime-suggestions-title"
      className="bg-card mb-4 rounded-lg border p-3"
    >
      <h2 id="uptime-suggestions-title" className="text-sm font-medium">
        {tr("uptime.suggestions.title")}
      </h2>
      <p className="text-muted-foreground mt-1 text-xs">
        {tr("uptime.suggestions.description")}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {props.instances.map((instance) => {
          const url = appUrl(instance) ?? "";
          return (
            <li
              key={instance.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm">
                  {instance.app}{" "}
                  <span className="text-muted-foreground">{instance.env}</span>
                </div>
                <div
                  className="text-muted-foreground truncate text-xs"
                  title={url}
                >
                  {appUrlLabel(url)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outlined"
                disabled={props.busy}
                aria-label={tr("uptime.suggestions.addFor", {
                  args: [`${instance.app} ${instance.env}`],
                })}
                onClick={() => props.onAdd(instance)}
              >
                {tr("uptime.suggestions.add")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default MonitorSuggestions;
