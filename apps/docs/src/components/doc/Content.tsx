import { IconArrowUp } from "@tabler/icons-react";
import { useEffect } from "react";
import { useWindowScroll } from "../../hooks/useWindowScroll.ts";
import BottomNavigation from "./BottomNavigation.tsx";
import EditLink from "./EditLink.tsx";
import FileHeader from "./FileHeader.tsx";
import HtmlContent from "./HtmlContent.tsx";
import TableOfContents from "./TableOfContents.tsx";

interface ContentProps {
  name: string;
  content: string;
  path?: string;
  readingTime?: number;
  lastModified?: string | null;
}

const Content = (props: ContentProps) => {
  const [scroll, scrollTo] = useWindowScroll();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
      }
    }
  }, []);

  return (
    <div
      className="flex flex-1 w-full"
      style={{
        minHeight: "100%",
        background: "var(--term-bg)",
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      }}
    >
      {/* Main Content */}
      <div
        className="flex flex-1 flex-col p-4 md:p-6 w-full mx-auto"
        style={{ maxWidth: 900 }}
      >
        {/* File Header */}
        <FileHeader
          name={props.name}
          path={props.path}
          readingTime={props.readingTime}
          lastModified={props.lastModified}
        />

        {/* Content */}
        <div
          style={{
            lineHeight: 1.8,
            fontSize: 14,
            color: "var(--term-text)",
          }}
        >
          <HtmlContent html={props.content} />
        </div>

        {/* Edit Link */}
        <EditLink path={props.path} />

        {/* Navigation */}
        <BottomNavigation name={props.name} />
      </div>

      {/* Table of Contents */}
      <TableOfContents name={props.name} />

      {/* Scroll to Top */}
      <div
        className="affix affix-bottom-right"
        style={{
          opacity: scroll.y > 300 ? 1 : 0,
          transform: scroll.y > 300 ? "translateY(0)" : "translateY(16px)",
          transition: "opacity 0.2s, transform 0.2s",
          pointerEvents: scroll.y > 300 ? "auto" : "none",
        }}
      >
        <button
          type="button"
          className="btn-reset flex items-center justify-center cursor-pointer"
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: "var(--term-bg-panel)",
            border: "1px solid var(--term-border)",
            color: "var(--term-green)",
          }}
          onClick={() => scrollTo({ y: 0 })}
        >
          <IconArrowUp size={18} />
        </button>
      </div>
    </div>
  );
};

export default Content;
