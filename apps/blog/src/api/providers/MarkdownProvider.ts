import { Marked } from "marked";

export class MarkdownProvider {
  protected marked = new Marked();

  render(markdown: string): string {
    if (!markdown) {
      return "";
    }

    return this.marked.parse(markdown, { async: false }) as string;
  }
}
