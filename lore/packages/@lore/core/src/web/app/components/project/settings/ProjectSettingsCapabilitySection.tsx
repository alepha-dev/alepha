import { Switch } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Fragment } from "react";

import type { CapabilityKey } from "../../../../../api/schemas/capabilityKeySchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { CapabilityRowRegistry } from "../../../registries/CapabilityRowRegistry.ts";
import { ProjectBlockerRegistry } from "../../../registries/ProjectBlockerRegistry.ts";
import { capabilityRegistry } from "../../../services/capabilityRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
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
  /**
   * Renders the rows alone, without the section around them, for a group
   * that holds several capabilities in one card: General (#Q4007).
   */
  bare?: boolean;
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
  const [project] = useStore(currentProjectAtom);
  const extraRows = useInject(CapabilityRowRegistry);
  // What a module's server guard would refuse turning this off on, said
  // before the click (#Q3281). Called in a fixed order: the registry is
  // frozen at first read.
  const blocking = useInject(ProjectBlockerRegistry)
    .blockers()
    .map((blocker) =>
      blocker.useLine(project?.id ?? 0, { capabilityOff: props.capability }),
    )
    .filter((line): line is string => !!line);

  const options = (props.options ?? descriptor.options.map((it) => it.key))
    .map((key) => descriptor.options.find((it) => it.key === key))
    .filter((it) => it !== undefined);
  const showMaster = props.master !== false;

  if (!showMaster && options.length === 0) return null;

  const rows = (
    <>
      {/* ⚠️ No propagation-delay banner (feedback #P2125). It capped all four
          capability pages with the same sentence, above the heading, which
          made it read as chrome rather than as help - and the delay it warned
          about is the owner's OWN 30 s read window, which they see resolve by
          reloading.

          The ranks page's warning is not the same and stays: it draws a
          contrast with removal taking effect at once. */}
      {showMaster && (
        <SettingsRow
          label={tr(descriptor.labelKey)}
          description={
            master.enabled && blocking.length > 0
              ? `${tr(descriptor.descriptionKey)} ${blocking.join(" ")}`
              : tr(descriptor.descriptionKey)
          }
        >
          <Switch
            // Disabled rather than hidden: a switch that vanished for a
            // member would leave them wondering what turns the capability
            // on, for a rank without `capability:manage`. Held on
            // while a module says what turning it off would strand.
            disabled={
              !master.canToggle ||
              master.busy ||
              (master.enabled && blocking.length > 0)
            }
            checked={master.enabled}
            onCheckedChange={(value) => {
              void master.toggle(value);
            }}
            // The capability's own name, not "Enable": General renders four
            // of these on one page.
            aria-label={tr(descriptor.labelKey)}
          />
        </SettingsRow>
      )}
      {options.map((option) => (
        <Fragment key={option.key}>
          <CapabilityOptionRow
            // Nested under the master, so the rows read as its children.
            className={showMaster ? "sm:pl-10" : undefined}
            capability={props.capability}
            option={option.key}
            label={tr(option.labelKey)}
            description={tr(option.descriptionKey)}
            // ⚠️ Disabled while the master is off, not hidden. An option that
            // vanished with its capability would make turning the capability on
            // feel like the page had changed under you, and it is also the only
            // way to see what turning it on would give you.
            disabled={!master.enabled || option.soon === true}
            soon={option.soon === true}
            requires={option.requires}
          />
          {/* A module's own rows after this option (#Q4184), nested the
            same way and disabled with the master. */}
          {showMaster &&
            extraRows
              .after(props.capability, option.key)
              .map((row) => (
                <row.component
                  key={row.key}
                  className={showMaster ? "sm:pl-10" : undefined}
                  disabled={!master.enabled}
                />
              ))}
        </Fragment>
      ))}
      {showMaster &&
        extraRows
          .of(props.capability)
          .filter((row) => !options.some((it) => it.key === row.after))
          .map((row) => (
            <row.component
              key={row.key}
              className="sm:pl-10"
              disabled={!master.enabled}
            />
          ))}
    </>
  );

  return props.bare ? rows : <SettingsSection>{rows}</SettingsSection>;
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
  /**
   * The option this one depends on: disabled while it is off.
   */
  requires?: string;
}

/**
 * One option's row. Its own component because `useCapabilityOption` is a hook
 * and a `.map` cannot call one.
 */
const CapabilityOptionRow = (props: CapabilityOptionRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const option = useCapabilityOption(props.capability, props.option);
  // Always called, on itself when there is no dependency: a hook's order
  // cannot depend on a prop.
  const parent = useCapabilityOption(
    props.capability,
    props.requires ?? props.option,
  );
  const parentOff = props.requires !== undefined && !parent.enabled;

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
        disabled={
          props.disabled || parentOff || !option.canToggle || option.busy
        }
        onCheckedChange={(value) => {
          void option.toggle(value);
        }}
        aria-label={props.label}
      />
    </SettingsRow>
  );
};
