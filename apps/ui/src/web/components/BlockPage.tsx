import type { ReactNode } from "react";

export interface BlockPageProps {
  title: string;
  /**
   * The import specifier a reader would copy. Shown verbatim, because finding
   * out where a component lives is most of what brings anyone to a catalogue.
   */
  source: string;
  description: string;
  children: ReactNode;
}

/**
 * The shell every block page shares: a title, the import path, and the
 * specimens below it.
 */
export const BlockPage = (props: BlockPageProps) => (
  <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
      <p className="text-muted-foreground max-w-2xl text-sm">
        {props.description}
      </p>
      <code className="bg-muted text-muted-foreground inline-block rounded px-2 py-1 font-mono text-xs">
        {props.source}
      </code>
    </header>
    <div className="space-y-6">{props.children}</div>
  </div>
);
