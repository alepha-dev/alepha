import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";
import { usePageCrumb } from "../../shared/usePageCrumb.ts";
import NotificationChannelsTab from "../settings/notifications/NotificationChannelsTab.tsx";
import AutomationPage from "./AutomationPage.tsx";

/**
 * Settings > Automations > Channels (#Q3614), until #Q3892 moves the tab
 * under Settings > Notifications: the project's notification channels
 * (#Q3891, #Q3900), drawn by `NotificationChannelsTab`.
 */
const AutomationChannelsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  usePageCrumb("projectAutomationChannels", tr("automation.channels.title"));
  return (
    <AutomationPage
      title={tr("automation.channels.title")}
      description={tr("automation.channels.description")}
    >
      <NotificationChannelsTab />
    </AutomationPage>
  );
};

export default AutomationChannelsPage;
