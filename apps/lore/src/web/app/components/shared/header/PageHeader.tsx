import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Home as HomeIcon } from "lucide-react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import HeaderActions from "./HeaderActions.tsx";

export type PageHeaderProps = {
  showHome?: boolean;
};

const PageHeader = (props: PageHeaderProps) => {
  const showHome = props.showHome ?? true;
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();

  return (
    <>
      {showHome && (
        <div className="fixed left-3 top-3 z-50">
          <Button
            render={<Link href={router.path("home")} />}
            variant="ghost"
            size="icon"
            aria-label="Home"
          >
            <HomeIcon className="size-4" />
            <span className="sr-only">{String(tr("home.title"))}</span>
          </Button>
        </div>
      )}
      <div className="fixed right-3 top-3 z-50">
        <HeaderActions />
      </div>
    </>
  );
};

export default PageHeader;
