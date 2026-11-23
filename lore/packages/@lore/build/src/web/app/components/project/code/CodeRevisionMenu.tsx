import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { GitBranch, Tag } from "lucide-react";

import type { codeRevisionSchema } from "../../../../../api/schemas/codeRevisionSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { type CodePageKind, codeHref } from "./codeHref.ts";

export interface CodeRevisionMenuProps {
  projectSlug: string;
  revision: Infer<typeof codeRevisionSchema>;
  kind: CodePageKind;
  path: string;
}

/**
 * Which branch or tag a code page reads (#Q4134): every branch and tag of
 * the repository, the page opened again at the same path on the one picked.
 */
const CodeRevisionMenu = (props: CodeRevisionMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [detail] = useStore(currentCodeRepoAtom);
  if (!detail) return null;
  const go = (name: string) =>
    router.push(
      codeHref(
        props.kind,
        props.projectSlug,
        detail.repository.slug,
        name,
        props.path,
      ),
    );
  const label =
    props.revision.kind === "commit"
      ? props.revision.sha.slice(0, 7)
      : props.revision.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outlined"
            size="sm"
            data-testid="code-revision-menu"
            aria-label={tr("code.revision.pick")}
          />
        }
      >
        {props.revision.kind === "tag" ? (
          <Tag className="size-3.5" />
        ) : (
          <GitBranch className="size-3.5" />
        )}
        <span className="max-w-48 truncate font-mono text-xs">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 min-w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>{tr("code.revision.branches")}</DropdownMenuLabel>
        {detail.branches.map((branch) => (
          <DropdownMenuItem
            key={`b:${branch.name}`}
            onClick={() => go(branch.name)}
          >
            <GitBranch className="size-3.5" />
            <span className="font-mono text-xs">{branch.name}</span>
          </DropdownMenuItem>
        ))}
        {detail.tags.length > 0 && <DropdownMenuSeparator />}
        {detail.tags.length > 0 && (
          <DropdownMenuLabel>{tr("code.revision.tags")}</DropdownMenuLabel>
        )}
        {detail.tags.map((tag) => (
          <DropdownMenuItem key={`t:${tag.name}`} onClick={() => go(tag.name)}>
            <Tag className="size-3.5" />
            <span className="font-mono text-xs">{tag.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CodeRevisionMenu;
