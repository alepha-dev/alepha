import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * A link out to the project's repository, in the header's icon cluster.
 *
 * Costs nothing to build, which is why feedback #2105 asked for it:
 * `projects.repositoryUrl` is already a column, already editable in settings
 * and already in `currentProjectAtom`, so this is a render and not a request.
 *
 * Three things it deliberately does not do:
 *
 * - **It does not assume GitHub.** The report says "github icon" because this
 *   project happens to be on GitHub; the column takes any URL. A GitLab
 *   project showing a GitHub mark is the kind of bug only its owner notices
 *   and nobody reports twice. `BrandIcon` carries a real GitHub mark, so that
 *   host gets it and every other host gets a neutral `GitBranch` - never
 *   somebody else's logo.
 * - **It does not render when there is nothing to open.** Most projects have
 *   no repository, and a dead icon in the topbar is worse than no icon. Same
 *   guard `HeaderSearchButton` uses to stay safe off-project.
 * - **It does not trust the stored value to parse.** `repositoryUrl` is
 *   permissive on read by design (`projectRepositoryUrlSchema` constrains it
 *   on the way IN, so "a stored value must always load"), so a row written
 *   before that schema existed must cost the icon, never the topbar.
 *
 * The tooltip names the HOST rather than reading "Repository": which project
 * this is, the reader knows; where the link goes is the part they cannot
 * guess.
 */
const HeaderRepositoryButton = (): ReactElement | null => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const url = project?.repositoryUrl;

  if (!url) {
    return null;
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }

  const label = String(tr("header.actions.repository"));
  // Endswith rather than includes, so `github.com.example.org` is not GitHub.
  const isGithub = host === "github.com" || host.endsWith(".github.com");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // `ghost` + `icon` and `nativeButton={false}`: it sits among
          // `AppActions`'s own four buttons, so it has to look like one while
          // actually being the anchor that opens the link.
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            aria-label={`${label}: ${host}`}
            render={
              <a
                href={url}
                target="_blank"
                // `noreferrer` implies `noopener`; both are named because the
                // destination is a URL the project owner typed.
                rel="noreferrer noopener"
              />
            }
          />
        }
      >
        {isGithub ? (
          <BrandIcon provider="github" />
        ) : (
          <GitBranch className="size-4 shrink-0" />
        )}
      </TooltipTrigger>
      <TooltipContent>{host}</TooltipContent>
    </Tooltip>
  );
};

export default HeaderRepositoryButton;
