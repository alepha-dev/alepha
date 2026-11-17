import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { type I18n, loreDocsUrl, OutboundLink } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface GuideLinkProps {
  guide: Parameters<typeof loreDocsUrl>[0];
}

/**
 * The link an empty Requirements list carries to its guide (#E153), as the
 * Releases list's empty state does.
 */
const GuideLink = (props: GuideLinkProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <OutboundLink
      href={loreDocsUrl(props.guide)}
      className={cn(
        textLinkUnderlineClassName,
        "hover:text-foreground text-muted-foreground text-sm",
      )}
    >
      {tr("requirements.guide")}
    </OutboundLink>
  );
};

export default GuideLink;
