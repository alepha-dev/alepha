import { useDialog } from "@alepha/ui";
import { Button } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";

/**
 * A confirm opened from a section stacks over the settings dialog, and
 * closing it leaves the dialog where it was.
 */
const SettingsBilling = () => {
  const dialog = useDialog();
  return (
    <div className="flex flex-col gap-8 p-4 md:p-6">
      <SettingsSection
        title="Billing"
        description="The plan this workspace is on."
      >
        <SettingsRow label="Plan" description="Team, billed monthly.">
          <Button
            variant="outlined"
            size="sm"
            onClick={() =>
              void dialog.confirm({
                title: "Switch to yearly billing?",
                description: "Two months free, charged today.",
              })
            }
          >
            Switch to yearly
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};

export default SettingsBilling;
