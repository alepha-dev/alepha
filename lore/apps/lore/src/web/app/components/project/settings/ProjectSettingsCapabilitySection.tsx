import { Switch } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import { useI18n } from "alepha/react/i18n";

import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { capabilityRegistry } from "@/web/app/services/capabilityRegistry.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { useCapabilityOption, useCapabilityToggle } from "./useCapability.ts";

export interface ProjectSettingsCapabilitySectionProps {
  capability: CapabilityKey;
  /**
   * Which of the capability's options to render, in this order. Omitted means
   * every option it declares.
   */
  options?: string[];
  /**
   * Whether to render the master switch. Default `true`.
   *
   * General > Capabilities renders it, with the options that add a sidebar
   * entry nested under it. A capability's own page passes `false` and lists
   * its other options: the master lives in General only, because once it is
   * off this page leaves the sidebar and General is where it comes back on
   * (#Q2565).
   */
  master?: boolean;
}

/**
 * A capability's master switch and the options inside it.
 *
 * The nine Features pages this replaces were four single switches, three pages
 * with one switch plus a section, and two configuration pages. Their labels
 * and descriptions came from a hand-maintained pair of `Record`s in
 * `ProjectSettingsFeatureSection`, keyed by feature name, with a conditional
 * type standing guard over the key set. The registry holds those keys now, so
 * the guard is the enum itself.
 *
 * ⚠️ **Every switch here may go off, the master included.** A project with no
 * capability at all is a legal state, and the reason is worth keeping: it is
 * the test that the modularity is real. The wizard is where "at least one"
 * lives.
 */
const ProjectSettingsCapabilitySection = (
  props: ProjectSettingsCapabilitySectionProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const descriptor = capabilityRegistry.get(props.capability);
  const master = useCapabilityToggle(props.capability);

  const options = (props.options ?? descriptor.options.map((it) => it.key))
    .map((key) => descriptor.options.find((it) => it.key === key))
    .filter((it) => it !== undefined);
  const showMaster = props.master !== false;

  if (!showMaster && options.length === 0) return null;

  return (
    <SettingsSection>
      {/* ⚠️ No propagation-delay banner (feedback #P2125). It capped all four
          capability pages with the same sentence, above the heading, which
          made it read as chrome rather than as help - and the delay it warned
          about is the owner's OWN 30 s read window, which they see resolve by
          reloading.

          The neighbouring warnings are not the same and stay: the roadmap
          card's is about what the PUBLIC sees, which the owner cannot check
          for themselves, and the ranks page's draws a contrast with removal
          taking effect at once. */}
      {showMaster && (
        <SettingsRow
          label={tr(descriptor.labelKey as never)}
          description={tr(descriptor.descriptionKey as never)}
        >
          <Switch
            // Disabled rather than hidden: a switch that vanished for a
            // member would leave them wondering what turns the capability
            // on. `capability:manage` is owner-only structurally.
            disabled={!master.canToggle || master.busy}
            checked={master.enabled}
            onCheckedChange={(value) => {
              void master.toggle(value);
            }}
            // The capability's own name, not "Enable": General renders four
            // of these on one page.
            aria-label={tr(descriptor.labelKey as never)}
          />
        </SettingsRow>
      )}
      {options.map((option) => (
        <CapabilityOptionRow
          key={option.key}
          // Nested under the master, so the rows read as its children.
          className={showMaster ? "sm:pl-10" : undefined}
          capability={props.capability}
          option={option.key}
          label={tr(option.labelKey as never)}
          description={tr(option.descriptionKey as never)}
          // ⚠️ Disabled while the master is off, not hidden. An option that
          // vanished with its capability would make turning the capability on
          // feel like the page had changed under you, and it is also the only
          // way to see what turning it on would give you.
          disabled={!master.enabled || option.soon === true}
          soon={option.soon === true}
        />
      ))}
    </SettingsSection>
  );
};

export default ProjectSettingsCapabilitySection;

interface CapabilityOptionRowProps {
  capability: CapabilityKey;
  option: string;
  label: string;
  description: string;
  disabled: boolean;
  soon: boolean;
  className?: string;
}

/**
 * One option's row. Its own component because `useCapabilityOption` is a hook
 * and a `.map` cannot call one.
 */
const CapabilityOptionRow = (props: CapabilityOptionRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const option = useCapabilityOption(props.capability, props.option);

  return (
    <SettingsRow
      className={props.className}
      label={
        props.soon
          ? `${props.label} · ${tr("project.create.soon")}`
          : props.label
      }
      description={props.description}
    >
      <Switch
        checked={option.enabled}
        disabled={props.disabled || !option.canToggle || option.busy}
        onCheckedChange={(value) => {
          void option.toggle(value);
        }}
        aria-label={props.label}
      />
    </SettingsRow>
  );
};
