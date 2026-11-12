import { cn } from "@alepha/ui";
import { SettingsHeading, settingsCardEdge } from "@alepha/ui/settings";

/**
 * A section whose content is not a card of rows uses the heading directly,
 * so every settings screen shares one type scale.
 */
const SettingsSessions = () => (
  <div className="flex flex-col gap-2 p-4 md:p-6">
    <SettingsHeading
      title="Active sessions"
      description="A section whose content is not a card of rows uses the heading directly."
    />
    <div className={cn(settingsCardEdge, "p-4")}>
      <p className="text-sm">
        Anything can go in the card. Only the edge has to agree, which is why{" "}
        <code className="bg-muted rounded px-1">settingsCardEdge</code> carries
        the border, the radius and the shadow, and no padding.
      </p>
    </div>
  </div>
);

export default SettingsSessions;
