import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Switch } from "@alepha/ui/components/ui/switch";
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

  return (
    <SettingsSection>
      {/* Said once, on the section, rather than on each of seven switches.
          Every read here goes through a 30 s window, so a change made in one
          browser reaches another when that window expires - the same delay the
          roadmap card already discloses, and for the same reason: the cache is
          a per-process Map, which on Workers means per isolate. */}
      <p className="text-muted-foreground px-1 text-xs">
        {tr("project.settings.capability.delay")}
      </p>
      <SettingsRow
        label={tr(descriptor.labelKey as never)}
        description={tr(descriptor.descriptionKey as never)}
      >
        <Switch
          checked={master.enabled}
          onCheckedChange={(value) => {
            void master.toggle(value);
          }}
          aria-label={tr("project.settings.feature.enable")}
        />
      </SettingsRow>
      {options.map((option) => (
        <CapabilityOptionRow
          key={option.key}
          capability={props.capability}
          option={option.key}
          label={String(tr(option.labelKey as never))}
          description={String(tr(option.descriptionKey as never))}
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
      label={
        props.soon
          ? `${props.label} · ${tr("project.create.soon")}`
          : props.label
      }
      description={props.description}
    >
      <Switch
        checked={option.enabled}
        disabled={props.disabled}
        onCheckedChange={(value) => {
          void option.toggle(value);
        }}
        aria-label={props.label}
      />
    </SettingsRow>
  );
};
