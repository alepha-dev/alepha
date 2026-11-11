import { ArrowUpRight, type LucideIcon } from "lucide-react";

export interface HomeWelcomeFeatureProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /**
   * The guide that explains it, on alepha.dev.
   */
  href: string;
}

/**
 * A small cell under the three pillars: something worth knowing that is not
 * a module of its own (agents over MCP, automations, self-hosting). One line
 * and a link to its guide, so it stays a footnote to the pillars rather than
 * a fourth one.
 */
const HomeWelcomeFeature = (props: HomeWelcomeFeatureProps) => {
  const Icon = props.icon;
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="bg-background hover:bg-muted/40 group flex items-start gap-3 px-5 py-4 transition-colors md:px-6"
    >
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1 text-sm font-medium">
          {props.title}
          <ArrowUpRight className="text-muted-foreground size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="text-muted-foreground text-xs leading-snug">
          {props.description}
        </span>
      </div>
    </a>
  );
};

export default HomeWelcomeFeature;
