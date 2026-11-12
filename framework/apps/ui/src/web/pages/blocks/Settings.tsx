import { Button } from "@alepha/ui";
import { useSettingsDialog } from "@alepha/ui/settings";
import { z } from "alepha";
import { Settings as SettingsIcon } from "lucide-react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * A settings dialog: `$settingsDialog` and its sections (see
 * `ShowcaseSettings`), opened over the page and drawn by `DialogProvider`.
 *
 * Large modal on a desktop, full screen on a phone, where the nav becomes a
 * list and a section slides in with a back arrow. The sections are built
 * from the content blocks that stay: `SettingsSection`, `SettingsRow`,
 * `SettingsHeading` and `SettingsDangerSection`.
 *
 * The knob picks the section `open()` lands on; "Last viewed" opens bare,
 * which reopens the section the reader left.
 */
const KNOBS = z.object({
  section: z
    .enum(["Last viewed", "profile", "sessions", "billing", "danger"])
    .default("Last viewed")
    .meta({ title: "Open on" }),
});

const Settings = () => {
  const workspace = useSettingsDialog("workspace");
  return (
    <Showcase
      id="blocks/Settings"
      title="Settings"
      description="A settings dialog over the page: grouped nav, sections, a danger zone."
      schema={KNOBS}
      initialValues={{ section: "Last viewed" }}
    >
      {(v) => (
        <div className="flex flex-col items-start">
          <Button
            onClick={() =>
              workspace.open(
                v.section === "Last viewed" ? undefined : v.section,
              )
            }
          >
            <SettingsIcon />
            Open settings
          </Button>
        </div>
      )}
    </Showcase>
  );
};

export default Settings;
