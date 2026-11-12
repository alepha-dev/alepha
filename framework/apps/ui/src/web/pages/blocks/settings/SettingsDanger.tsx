import { Button } from "@alepha/ui";
import { SettingsDangerSection, SettingsRow } from "@alepha/ui/settings";

/**
 * The boundary between "change your display name" and "delete your
 * workspace".
 */
const SettingsDanger = () => (
  <div className="flex flex-col gap-8 p-4 md:p-6">
    <SettingsDangerSection description="These cannot be undone.">
      <SettingsRow
        label="Transfer ownership"
        description="Hand this workspace to another member."
      >
        <Button variant="outlined" intent="danger" size="sm">
          Transfer
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Delete this workspace"
        description="Every project, folio and quest goes with it."
      >
        <Button variant="outlined" intent="danger" size="sm">
          Delete
        </Button>
      </SettingsRow>
    </SettingsDangerSection>
  </div>
);

export default SettingsDanger;
