import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { File, Image as ImageIcon, Trash2 } from "lucide-react";
import { useState } from "react";

export interface AttachmentBadgeProps {
  fileId: string;
  onRemove?: (fileId: string) => void;
  disabled?: boolean;
}

const AttachmentBadge = (props: AttachmentBadgeProps) => {
  const { fileId, onRemove, disabled } = props;
  const [isImage, setIsImage] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const fileUrl = `/api/files/${fileId}`;

  const handleImageError = () => setIsImage(false);
  const handleImageLoad = () => setImageLoaded(true);

  const badge = (
    <Badge
      variant="secondary"
      className="flex cursor-pointer items-center gap-1.5 px-2 py-1"
      onClick={() => window.open(fileUrl, "_blank")}
    >
      {isImage && imageLoaded ? (
        <ImageIcon className="size-3.5" />
      ) : (
        <File className="size-3.5" />
      )}
      <span>{fileId.slice(0, 8)}…</span>
      {!disabled && onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-4 w-4 p-0 text-red-500 hover:bg-transparent hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(fileId);
          }}
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </Badge>
  );

  const hiddenImage = (
    <img
      src={fileUrl}
      alt=""
      className="hidden"
      onError={handleImageError}
      onLoad={handleImageLoad}
    />
  );

  if (isImage) {
    return (
      <>
        {hiddenImage}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={badge}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          />
          <PopoverContent className="w-72 p-2">
            <img
              src={fileUrl}
              alt="Preview"
              className="h-48 w-full rounded object-contain"
              onError={handleImageError}
            />
            {imageLoaded && (
              <p className="text-muted-foreground mt-2 text-center text-xs">
                Click to open full size
              </p>
            )}
          </PopoverContent>
        </Popover>
      </>
    );
  }

  return badge;
};

export default AttachmentBadge;
