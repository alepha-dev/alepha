import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * The switches, and the credential.
 *
 * The shell landed first (#Q1904) so every tab is reachable the day the route
 * exists; this page is filled in by its own quest.
 */
const BaySettings = () => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{tr("bay.settings.title")}</h2>
      <p className="text-muted-foreground text-sm">{tr("bay.soon")}</p>
    </div>
  );
};

export default BaySettings;
