import { Button, Input, Switch } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";

/**
 * A card of rows: a label and one control each, the label a real `<label>`
 * when the row is given an `htmlFor`.
 */
const SettingsProfile = () => (
  <div className="flex flex-col gap-8 p-4 md:p-6">
    <SettingsSection
      title="Profile"
      description="How you appear to everyone else in this workspace."
    >
      <SettingsRow
        label="Display name"
        description="Shown on everything you create."
        htmlFor="showcase-settings-name"
      >
        <Input
          id="showcase-settings-name"
          defaultValue="Ada Lovelace"
          className="w-56"
        />
      </SettingsRow>
      <SettingsRow
        label="Email"
        description="Used for sign-in and for every notification."
      >
        <span className="text-muted-foreground text-sm">ada@alepha.dev</span>
      </SettingsRow>
      <SettingsRow
        label="Weekly digest"
        description="One summary on Monday morning, instead of a mail per event."
        htmlFor="showcase-settings-digest"
      >
        <Switch id="showcase-settings-digest" defaultChecked />
      </SettingsRow>
      <SettingsRow label="Plan">
        <Button variant="outlined" size="sm">
          Change plan
        </Button>
      </SettingsRow>
    </SettingsSection>
  </div>
);

export default SettingsProfile;
