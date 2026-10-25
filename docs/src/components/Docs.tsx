import { useEffect } from "react";

import type { DocProduct } from "../config/docs.ts";
import BottomNavigation from "./doc/BottomNavigation.tsx";
import FileHeader from "./doc/FileHeader.tsx";
import HtmlContent from "./doc/HtmlContent.tsx";
import TableOfContents from "./doc/TableOfContents.tsx";

interface ContentProps {
  product: DocProduct;
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
      className="flex w-full flex-1"
      style={{
        minHeight: "100%",
        background: "var(--color-bg)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Main Content */}
      <div
        className="mx-auto flex w-full flex-1 flex-col gap-4 p-4 md:p-6"
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
        <BottomNavigation product={props.product} name={props.name} />
      </div>

      {/* Table of Contents */}
      <TableOfContents name={props.name} />
    </div>
  );
};

export default Docs;
