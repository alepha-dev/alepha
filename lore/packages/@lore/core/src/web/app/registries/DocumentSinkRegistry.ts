import { AlephaError } from "alepha";

/**
 * Where a page can save a generated markdown document for the project to
 * keep (#E75, #Q2624): Knowledge registers folios. A release saves its
 * changelog through it without knowing what a folio is, and offers nothing
 * when no module registered one.
 */
export class DocumentSinkRegistry {
  protected current?: DocumentSink;

  public register(sink: DocumentSink): void {
    if (this.current) {
      throw new AlephaError(
        `A document sink is registered twice ('${this.current.key}', '${sink.key}')`,
      );
    }
    this.current = sink;
  }

  /**
   * The registered sink, when this reader may write to it.
   */
  public writable(): DocumentSink | undefined {
    return this.current?.can() ? this.current : undefined;
  }
}

export interface DocumentSink {
  key: string;
  /**
   * Whether the reader may save here at all, read synchronously during
   * render, like a client action's `can()`.
   */
  can: () => boolean;
  save: (document: SavedDocument) => Promise<void>;
}

export interface SavedDocument {
  projectId: number;
  title: string;
  content: string;
  /**
   * The one-line summary written for agents.
   */
  summary: string;
}
