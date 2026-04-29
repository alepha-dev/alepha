import { ActionButton, Text } from "@alepha/mantine";
import { Badge, HoverCard, Image } from "@mantine/core";
import { IconFile, IconPhoto, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

export interface AttachmentBadgeProps {
  fileId: string;
  onRemove?: (fileId: string) => void;
  disabled?: boolean;
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];

const AttachmentBadge = (props: AttachmentBadgeProps) => {
  const { fileId, onRemove, disabled } = props;
  const [isImage, setIsImage] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);

  const fileUrl = `/api/files/${fileId}`;

  const handleImageError = () => {
    setIsImage(false);
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  const badge = (
    <Badge
      size="lg"
      variant="light"
      leftSection={
        isImage && imageLoaded ? (
          <IconPhoto size={14} />
        ) : (
          <IconFile size={14} />
        )
      }
      rightSection={
        !disabled &&
        onRemove && (
          <ActionButton
            size="xs"
            variant="transparent"
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(fileId);
            }}
          >
            <IconTrash size={12} />
          </ActionButton>
        )
      }
      style={{ cursor: "pointer" }}
      onClick={() => window.open(fileUrl, "_blank")}
    >
      {fileId.slice(0, 8)}...
    </Badge>
  );

  // Hidden image to detect if file is an image
  const hiddenImage = (
    <img
      src={fileUrl}
      alt=""
      style={{ display: "none" }}
      onError={handleImageError}
      onLoad={handleImageLoad}
    />
  );

  // If it's an image, wrap with HoverCard for preview
  if (isImage) {
    return (
      <>
        {hiddenImage}
        <HoverCard
          width={280}
          shadow="md"
          openDelay={300}
          closeDelay={100}
          position="top"
          withArrow
        >
          <HoverCard.Target>{badge}</HoverCard.Target>
          <HoverCard.Dropdown p="xs">
            <Image
              src={fileUrl}
              alt="Preview"
              radius="sm"
              fit="contain"
              h={200}
              fallbackSrc=""
              onError={handleImageError}
            />
            {imageLoaded && (
              <Text size="xs" c="dimmed" ta="center" mt="xs">
                Click to open full size
              </Text>
            )}
          </HoverCard.Dropdown>
        </HoverCard>
      </>
    );
  }

  return badge;
};

export default AttachmentBadge;
