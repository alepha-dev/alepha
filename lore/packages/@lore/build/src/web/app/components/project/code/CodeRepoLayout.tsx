import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouterState } from "alepha/react/router";
import { FolderGit2 } from "lucide-react";

import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { CODE_REPO_TABS } from "./codeRepoTabs.ts";

/**
 * A repository's shell (#Q4133): its name and default branch on a plate,
 * the tabs the code pages mount under, and a note while the commit index
 * is still catching up with the default branch.
 */
const CodeRepoLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const state = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  if (!project || !detail) return null;

  const active = state.name ?? "";
  const tabs: PlateTab[] = CODE_REPO_TABS.map((tab) => ({
    key: tab.key,
    label: tr(tab.labelKey),
    href: tab.href(
      project.slug,
      detail.repository.slug,
      detail.repository.defaultBranch,
    ),
  }));
  const activeTab =
    CODE_REPO_TABS.find((tab) => tab.routes.includes(active))?.key ?? "files";

  return (
    <PlateLayout
      tabsTestId="code-repo-tabs"
      tabs={tabs}
      active={activeTab}
      plate={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 pb-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FolderGit2 className="text-muted-foreground size-5" aria-hidden />
            {detail.repository.slug}
          </h1>
          <span className="text-muted-foreground text-xs">
            {tr("code.repo.defaultBranch", {
              args: [detail.repository.defaultBranch],
            })}
          </span>
          {detail.indexing && (
            <span
              className="text-muted-foreground ml-auto text-xs"
              data-testid="code-indexing"
            >
              {tr("code.repo.indexing")}
            </span>
          )}
        </div>
      }
    >
      <NestedView />
    </PlateLayout>
  );
};

export default CodeRepoLayout;
