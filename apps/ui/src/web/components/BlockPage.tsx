import type { ReactNode } from "react";

export interface BlockPageProps {
  title: string;
  /**
   * One short line, or nothing. The components below are the documentation;
   * a paragraph here only pushes them off the screen.
   */
  description?: string;
  children: ReactNode;
}

/**
 * The shell every block page shares.
 *
 * Full width on purpose: the widest things here are shells, tables and split
 * auth screens, and a centred column made every one of them render in a letter
 * box on a large display.
 */
export const BlockPage = (props: BlockPageProps) => (
  <div className="w-full space-y-4 p-6">
    <header>
      <h1 className="text-xl font-semibold tracking-tight">{props.title}</h1>
      {props.description ? (
        <p className="text-muted-foreground text-sm">{props.description}</p>
      ) : null}
    </header>
    <div className="space-y-4">{props.children}</div>
  </div>
);
