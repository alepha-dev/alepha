import type { ProjectCreateDialogProps } from "@lore/core/web";
import { useRouter } from "alepha/react/router";

import AppCreateDialog from "./AppCreateDialog.tsx";

/**
 * New app, from the header's "+" menu (registered by `DeployShell`, #E75,
 * #Q2624). The one create dialog, mounted here and from the Apps list. It
 * navigates to what it made, the way New Epic and New Release do: creating
 * from the header and landing back where you started is the shape that makes
 * people click twice.
 */
const AppCreateMenuDialog = (props: ProjectCreateDialogProps) => {
  const router = useRouter();

  return (
    <AppCreateDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCreated={(instance) => {
        void router.push("app", {
          params: {
            projectSlug: props.project.slug,
            app: instance.app,
            env: instance.env,
          },
        });
      }}
    />
  );
};

export default AppCreateMenuDialog;
