import { currentProjectAtom, hasCapability } from "@lore/core/web";
import { useStore } from "alepha/react";

import ProjectSettingsCoverageTarget from "./ProjectSettingsCoverageTarget.tsx";

/**
 * Ship > Features: the coverage target. The capability switches are in
 * General > Capabilities only (#Q3702).
 *
 * The default environment was a third until #Q2135. It was project-wide while
 * the question it answered is per app, so a project set to `production` with
 * an app whose only copy is `preview` held a setting that could only ever be
 * wrong - and it outranked the single place that app could go. The CLI reads
 * the app's own rows now, and `defaultAppInstance` is back to its fixed rule.
 *
 * ## What left, and why nothing replaced it
 *
 * This page used to enrol apps and list their credentials. Both are gone
 * (#1770). Creating a deployed copy is what `/apps` is for, and a list of the
 * same things in Settings is a second door onto one room - the shape that had
 * an operator wondering which of the two was authoritative. The credential's
 * own controls (token prefix, rotate, remove) followed the credential down to
 * the instance that holds it, where the analytics they would destroy are also
 * shown.
 *
 * ## The key finally matches the label
 *
 * This page was `projectSettingsSigils` at `/settings/sigils`, writing
 * `features.sigils`, while every label on it said Apps - because a key inside
 * `projects.features` could not be renamed without every project that had the
 * module on silently losing it. Moving the storage to a row of its own is what
 * let the name move: the capability is `apps`, and `track` is the option that
 * carries what `sigils` actually gated.
 *
 * ## Ignore rules moved to Plan > Errors (#Q3703)
 *
 * `projectErrorIgnoreRules` is project-scoped on purpose: one rule mutes a
 * noisy error across every app the project owns. It sat here because there
 * was no Errors settings page; the Errors inbox is in the sidebar's Plan
 * group, so its rules are now a Plan tab (`ProjectSettingsErrorsPage`).
 */
const ProjectSettingsAppsPage = () => {
  const [project] = useStore(currentProjectAtom);

  const enabled = hasCapability(project, "ship");

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Every Ship switch, Track, Deploy and Monitor apps included, is in
          General > Capabilities only (#Q3702): this page listed the same
          rows a second time. What is left is Ship's one setting that is not
          a switch, the coverage target, and the tab stays for it. */}
      {enabled && <ProjectSettingsCoverageTarget />}
    </div>
  );
};

export default ProjectSettingsAppsPage;
