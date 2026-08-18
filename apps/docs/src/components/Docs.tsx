import { useEffect } from "react";
import BottomNavigation from "./doc/BottomNavigation.tsx";
import FileHeader from "./doc/FileHeader.tsx";
import HtmlContent from "./doc/HtmlContent.tsx";
import TableOfContents from "./doc/TableOfContents.tsx";

interface ContentProps {
  name: string;
  content: string;
  path?: string;
  readingTime?: number;
  lastModified?: string | null;
}

const Docs = (props: ContentProps) => {
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
        background: "var(--color-bg)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Main Content */}
      <div
        className="flex flex-1 flex-col p-4 md:p-6 w-full mx-auto gap-4"
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
            color: "var(--color-text)",
          }}
        >
          <HtmlContent html={props.content} />
        </div>

        {/* Navigation */}
        <BottomNavigation name={props.name} />
      </div>

      {/* Table of Contents */}
      <TableOfContents name={props.name} />
    </div>
  );
};

export default Docs;
