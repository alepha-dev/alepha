import { ActionButton } from "@alepha/ui";
import { IconPencil } from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { currentUserAtom } from "alepha/security";

export interface PostPageEditLinkProps {
  slug: string;
}

export const PostPageEditLink = (props: PostPageEditLinkProps) => {
  const [user] = useStore(currentUserAtom);

  if (!user) {
    return null;
  }

  return (
    <ActionButton
      size="xs"
      variant="default"
      icon={IconPencil}
      href={`/admin/posts/${props.slug}/edit`}
    >
      Edit this post
    </ActionButton>
  );
};
