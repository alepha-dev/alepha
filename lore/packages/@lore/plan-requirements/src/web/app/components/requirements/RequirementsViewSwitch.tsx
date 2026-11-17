import { Segmented } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

export interface RequirementsViewSwitchProps {
  view: "list" | "matrix";
}

/**
 * List or Matrix, on the Requirements tab (#E153). The switch navigates:
 * the view is `?view=matrix`, a link that survives a reload, read from the
 * URL and never written back by an effect.
 */
const RequirementsViewSwitch = (props: RequirementsViewSwitchProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  // This package's own page, named by string.
  const router = useRouter<any>();
  return (
    <Segmented
      size="sm"
      value={props.view}
      data-testid="requirements-view"
      onChange={(value) =>
        void router.push("projectRequirements", {
          params: { projectSlug: project?.slug ?? "" },
          query: value === "matrix" ? { view: "matrix" } : {},
        })
      }
      options={[
        { value: "list", label: tr("requirements.requirement.view.list") },
        { value: "matrix", label: tr("requirements.requirement.view.matrix") },
      ]}
    />
  );
};

export default RequirementsViewSwitch;
