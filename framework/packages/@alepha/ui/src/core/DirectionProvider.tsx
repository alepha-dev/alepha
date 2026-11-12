import { DirectionProvider as BaseDirectionProvider } from "@base-ui/react/direction-provider";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

export interface DirectionProviderProps {
  /**
   * The reading direction to give the components below. Defaults to the
   * active language's, from `useI18n().dir`, so a switch to Arabic or Hebrew
   * flips it with nothing else to do.
   */
  direction?: "ltr" | "rtl";
  children?: ReactNode;
}

/**
 * Tells Base UI which way the page reads.
 *
 * `<html dir>` is enough for CSS: the logical utilities and the `rtl:`
 * variants follow it on their own. Base UI also decides things in script
 * that CSS cannot reach, and reads the direction from this provider rather
 * than from the document: which side `inline-start` and `inline-end` resolve
 * to for a popup, which arrow key moves forward in a menu, a slider or a tab
 * list. Without it every Base UI part behaves left-to-right.
 *
 * A non-`embedded` `AppShell` mounts one. An application with its own layout
 * mounts it once, around everything that renders a Base UI part.
 */
export const DirectionProvider = (props: DirectionProviderProps) => {
  const { dir } = useI18n();
  return (
    <BaseDirectionProvider direction={props.direction ?? dir}>
      {props.children}
    </BaseDirectionProvider>
  );
};
