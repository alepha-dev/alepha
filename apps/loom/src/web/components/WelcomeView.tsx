import { Link } from "alepha/react/router";
import { FolderPlus } from "lucide-react";
import { useState } from "react";

import type { Project } from "../../api/schemas/projectSchema.ts";
import { AddProjectDialog } from "./AddProjectDialog.tsx";

export interface WelcomeViewProps {
  projects: Project[];
}

/**
 * What the editor shows before a project is picked, laid out like VS Code's
 * welcome page: a way to start, and what is already there.
 */
export const WelcomeView = (props: WelcomeViewProps) => {
  const [adding, setAdding] = useState(false);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-12 px-10 py-16">
      <header className="flex items-center gap-5">
        <img src="/loom.svg" alt="" width={56} height={56} />
        <div>
          <h1 className="text-[32px] leading-tight font-light tracking-tight">
            Loom
          </h1>
          <p className="text-muted-foreground text-[15px]">
            Every worktree of a repository, and what is happening in it.
          </p>
        </div>
      </header>

      <div className="grid gap-10 sm:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px]">Start</h2>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-warp flex w-fit items-center gap-2 hover:underline"
          >
            <FolderPlus className="size-4" strokeWidth={1.75} />
            Add project...
          </button>
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="text-[15px]">Projects</h2>
          {props.projects.length === 0 && (
            <p className="text-muted-foreground">None yet.</p>
          )}
          {props.projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="flex min-w-0 items-baseline gap-3"
            >
              <span className="text-warp shrink-0 hover:underline">
                {project.name}
              </span>
              <span className="text-muted-foreground truncate font-mono text-[12px]">
                {project.path}
              </span>
            </Link>
          ))}
        </section>
      </div>

      <AddProjectDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
};
