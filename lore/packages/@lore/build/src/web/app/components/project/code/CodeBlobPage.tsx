import { Button, Segmented } from "@alepha/ui";
import { highlightLanguageOf } from "@alepha/ui/markdown";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Download, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { codeFileSchema } from "../../../../../api/schemas/codeFileSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { codeHref, codeRawHref, parseLineHash } from "./codeHref.ts";
import CodeLines from "./CodeLines.tsx";
import CodeMarkdown from "./CodeMarkdown.tsx";
import CodePathCrumbs from "./CodePathCrumbs.tsx";
import CodeRevisionMenu from "./CodeRevisionMenu.tsx";

export interface CodeBlobPageProps {
  file: Infer<typeof codeFileSchema>;
}

/**
 * One file at a revision (#Q4134): highlighted, its lines numbered and
 * selectable (`#L10-L20`, Shift to extend), a raw download, a permalink
 * that swaps the branch or tag for its commit, and Markdown rendered with a
 * source toggle. A binary file or one over the cap says so and offers the
 * download.
 */
const CodeBlobPage = (props: CodeBlobPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  const { file } = props;
  const markdown = /\.(md|markdown)$/i.test(file.path);
  const [view, setView] = useState<"rendered" | "source">(
    markdown ? "rendered" : "source",
  );
  const [selected, setSelected] = useState<[number, number] | undefined>();
  useEffect(() => {
    const read = () => setSelected(parseLineHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    // A selected line is scrolled to: the DOM is the external system here.
    if (selected) {
      document
        .getElementById(`L${selected[0]}`)
        ?.scrollIntoView?.({ block: "center" });
    }
  }, [selected?.[0]]);
  // A selected line shows the source, whatever the toggle says.
  const shown = selected ? "source" : view;
  if (!project || !detail) return null;
  const repoSlug = detail.repository.slug;
  const hash = selected
    ? selected[0] === selected[1]
      ? `#L${selected[0]}`
      : `#L${selected[0]}-L${selected[1]}`
    : "";

  const select = (line: number, extend: boolean) => {
    const next: [number, number] =
      extend && selected
        ? [Math.min(selected[0], line), Math.max(selected[0], line)]
        : [line, line];
    setSelected(next);
    const anchor =
      next[0] === next[1] ? `#L${next[0]}` : `#L${next[0]}-L${next[1]}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${anchor}`,
    );
  };

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="code-blob">
      <div className="flex flex-wrap items-center gap-3">
        <CodeRevisionMenu
          projectSlug={project.slug}
          revision={file.revision}
          kind="blob"
          path={file.path}
        />
        <CodePathCrumbs
          projectSlug={project.slug}
          repoSlug={repoSlug}
          revision={file.revision.name}
          path={file.path}
        />
        <div className="ml-auto flex items-center gap-2">
          {markdown && file.status === "ok" && (
            <Segmented
              size="sm"
              value={shown}
              onChange={(value) => {
                setView(value as "rendered" | "source");
                if (value === "rendered") {
                  setSelected(undefined);
                  window.history.replaceState(
                    null,
                    "",
                    `${window.location.pathname}${window.location.search}`,
                  );
                }
              }}
              options={[
                { value: "rendered", label: tr("code.file.rendered") },
                { value: "source", label: tr("code.file.source") },
              ]}
            />
          )}
          {file.revision.kind !== "commit" && (
            <Button
              variant="outlined"
              size="sm"
              data-testid="code-permalink"
              onClick={() =>
                router.push(
                  `${codeHref("blob", project.slug, repoSlug, file.revision.sha, file.path)}${hash}` as `/${string}`,
                )
              }
            >
              <Link2 className="size-3.5" />
              {tr("code.file.permalink")}
            </Button>
          )}
          <Button
            variant="outlined"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={codeRawHref(
                  project.id,
                  repoSlug,
                  file.revision.sha,
                  file.path,
                )}
                data-testid="code-raw"
              />
            }
          >
            <Download className="size-3.5" />
            {tr("code.file.raw")}
          </Button>
        </div>
      </div>
      <span className="text-muted-foreground text-xs">
        {tr("code.file.size", { args: [String(file.size)] })}
      </span>

      {file.status === "binary" && (
        <p
          className="text-muted-foreground rounded-md border p-6 text-center text-sm"
          data-testid="code-binary"
        >
          {tr("code.file.binary")}
        </p>
      )}
      {file.status === "too_large" && (
        <p
          className="text-muted-foreground rounded-md border p-6 text-center text-sm"
          data-testid="code-too-large"
        >
          {tr("code.file.tooLarge")}
        </p>
      )}
      {file.status === "ok" &&
        file.text !== undefined &&
        (markdown && shown === "rendered" ? (
          <section
            className="rounded-md border p-4"
            data-testid="code-markdown"
          >
            <CodeMarkdown
              text={file.text}
              path={file.path}
              projectId={project.id}
              projectSlug={project.slug}
              repoSlug={repoSlug}
              revision={file.revision.name}
              sha={file.revision.sha}
            />
          </section>
        ) : (
          <CodeLines
            text={file.text}
            language={highlightLanguageOf(file.path)}
            selected={selected}
            onSelect={select}
          />
        ))}
    </div>
  );
};

export default CodeBlobPage;
