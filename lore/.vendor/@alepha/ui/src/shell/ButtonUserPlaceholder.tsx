import { cn } from "../core/utils.ts";

export interface ButtonUserPlaceholderProps {
  /**
   * The variant of the button it stands for: an outlined button keeps its
   * border, so the swap moves nothing.
   */
  variant?: "minimal" | "outlined";
}

/**
 * What a shared page shows where `ButtonUser` goes, before hydration: an
 * empty slot the size of the icon button. Neither the sign-in icon nor an
 * avatar, since the shared page cannot know which one its visitor gets.
 */
export const ButtonUserPlaceholder = (props: ButtonUserPlaceholderProps) => (
  <span
    aria-hidden
    data-slot="button-user-placeholder"
    className={cn(
      "inline-block size-9 shrink-0 rounded-md",
      props.variant === "outlined" && "border",
    )}
  />
);
