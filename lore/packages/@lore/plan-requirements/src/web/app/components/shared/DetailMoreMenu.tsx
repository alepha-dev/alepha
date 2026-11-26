import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { type LucideIcon, MoreVertical } from "lucide-react";

export interface DetailMoreMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
}

export interface DetailMoreMenuProps {
  items: DetailMoreMenuItem[];
  disabled?: boolean;
}

/**
 * The overflow menu at the end of a detail page's actions (#E153): what a
 * reader does rarely, a delete above all, behind three dots, where a list's
 * row menu keeps it. Renders nothing with no item.
 */
const DetailMoreMenu = (props: DetailMoreMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  if (props.items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="minimal"
            size="icon"
            disabled={props.disabled}
            aria-label={tr("requirements.more")}
            title={tr("requirements.more")}
            data-testid="detail-more"
          />
        }
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            variant={item.destructive ? "destructive" : "default"}
            onClick={item.onSelect}
          >
            <item.icon className="size-4" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DetailMoreMenu;
