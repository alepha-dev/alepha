import { highlightLines } from "@alepha/ui/markdown";
import { useMemo } from "react";

export interface CodeLinesProps {
  text: string;
  language?: string;
  /**
   * The selected range, 1-based and inclusive.
   */
  selected?: [number, number];
  /**
   * A line number clicked; `extend` with Shift held, to grow a range.
   */
  onSelect?: (line: number, extend: boolean) => void;
}

/**
 * A file's lines, numbered and highlighted one by one with the grammars
 * `MarkdownView` uses (#Q4134). Each number is a link to `#L<n>`, so a
 * selection is a URL; the trailing newline draws no empty last line.
 */
const CodeLines = (props: CodeLinesProps) => {
  const lines = useMemo(() => {
    const all = highlightLines(props.text, props.language);
    return props.text.endsWith("\n") ? all.slice(0, -1) : all;
  }, [props.text, props.language]);
  const [from, to] = props.selected ?? [0, -1];
  return (
    <div
      className="hljs overflow-x-auto rounded-md border text-xs"
      data-testid="code-lines"
    >
      <table className="w-full border-collapse font-mono">
        <tbody>
          {lines.map((tokens, index) => {
            const number = index + 1;
            const active = number >= from && number <= to;
            return (
              <tr
                key={number}
                id={`L${number}`}
                data-selected={active || undefined}
                className={active ? "bg-hover" : undefined}
              >
                <td className="text-muted-foreground w-1 px-3 text-right align-top whitespace-nowrap select-none">
                  <a
                    href={`#L${number}`}
                    className="hover:text-foreground"
                    onClick={(event) => {
                      if (!props.onSelect) return;
                      event.preventDefault();
                      props.onSelect(number, event.shiftKey);
                    }}
                  >
                    {number}
                  </a>
                </td>
                <td className="pr-4 align-top whitespace-pre">
                  {tokens.length === 0
                    ? " "
                    : tokens.map((token, at) =>
                        token.className ? (
                          <span key={at} className={token.className}>
                            {token.value}
                          </span>
                        ) : (
                          <span key={at}>{token.value}</span>
                        ),
                      )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default CodeLines;
