import * as React from "react";

void React;

import { File as FileIcon } from "lucide-react";
import { useState } from "react";

export interface ControlUploadItemThumbProps {
  url: string;
  alt: string;
}

export const ControlUploadItemThumb = (props: ControlUploadItemThumbProps) => {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded">
        <FileIcon className="size-4" />
      </div>
    );
  }
  return (
    <img
      src={props.url}
      alt={props.alt}
      className="size-7 shrink-0 rounded object-cover"
      onError={() => setBroken(true)}
    />
  );
};
