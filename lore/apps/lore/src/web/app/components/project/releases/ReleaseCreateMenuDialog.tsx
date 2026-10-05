import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import type { ProjectCreateDialogProps } from "../../../registries/ProjectShellRegistry.ts";
import { suggestedReleaseTag } from "./releaseBumps.ts";
import ReleaseCreateDialog from "./ReleaseCreateDialog.tsx";

/**
 * New release, from the header's "+" menu (registered by `WorkShell`, #E75,
 * #Q2624): #1635's surface, reused rather than a second one built here.
 */
const ReleaseCreateMenuDialog = (props: ProjectCreateDialogProps) => {
  const router = useRouter();
  // Only for the dialog's placeholder. The Releases table computes the same
  // suggestion from its own fresher fetch; this mount has no fetch of its
  // own, and the atom is what it can read. Both pass one, or the same dialog
  // would hint differently depending on the door that opened it.
  const [releases] = useStore(currentReleasesAtom);
  const projectSlug = props.project.slug;

  return (
    <ReleaseCreateDialog
      projectId={props.project.id}
      open={props.open}
      onOpenChange={props.onOpenChange}
      suggestedTag={suggestedReleaseTag(releases ?? [])}
      onCreated={(created) => {
        props.onOpenChange(false);
        // Onto the release itself, the way New Epic opens the epic it just
        // made. A release is addressed by its TAG, and the row is unreachable
        // without one, so a tagless answer falls back to the list rather
        // than routing to a broken URL.
        void (created.tag
          ? router.push("projectRelease", {
              params: { projectSlug, releaseTag: created.tag },
            })
          : router.push("projectReleases", { params: { projectSlug } }));
      }}
    />
  );
};

export default ReleaseCreateMenuDialog;
