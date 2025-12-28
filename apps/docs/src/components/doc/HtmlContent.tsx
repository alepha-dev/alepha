import { useMemo } from "react";

interface HtmlContentProps {
  html: string;
}

const HtmlContent = (props: HtmlContentProps) => {
  const html = useMemo(() => {
    const onclick = (url: string) => {
      return `event.preventDefault();go('${url}')`;
    };
    return props.html.replace(/<a href="\/docs\/(.*)">/gim, (_, arg1) => {
      const pathname = `${import.meta.env.BASE_URL ?? "/"}docs/${arg1}`;
      return `<a href="${pathname}" onclick="${onclick(`/docs/${arg1}`)}">`;
    });
  }, [props.html]);

  return (
    <div
      id="html-content"
      className="terminal-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default HtmlContent;
