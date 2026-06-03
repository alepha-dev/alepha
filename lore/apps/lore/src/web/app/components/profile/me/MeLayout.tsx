import { Button } from "@alepha/ui/components/ui/button";
import { useAuth } from "alepha/react/auth";
import { Link, NestedView, useRouter } from "alepha/react/router";
import { Home } from "lucide-react";
import type { AppRouter } from "../../../AppRouter.ts";
import { displayName } from "../../../services/displayName.ts";
import PageHeader from "../../shared/header/PageHeader.tsx";
import { UserAvatar } from "../../shared/UserAvatar.tsx";
import MeLayoutMenu from "./MeLayoutMenu.tsx";

const MeLayout = () => {
  const auth = useAuth();
  const router = useRouter<AppRouter>();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-auto border-x border-border bg-background p-4 pt-16">
      <PageHeader />
      {/* Compact header */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-card p-4">
        <UserAvatar fileId={auth.user?.picture} className="size-10" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            {displayName(auth.user)}
          </span>
          <span className="text-xs text-muted-foreground">
            {auth.user?.email}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          render={<Link href={router.path("home")} aria-label="Home" />}
        >
          <Home className="size-4" />
          <span className="hidden sm:inline">Home</span>
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-auto md:flex-row">
        <div className="md:w-48 md:min-w-48">
          <MeLayoutMenu />
        </div>
        <div className="flex flex-1 overflow-auto">
          <NestedView />
        </div>
      </div>
    </div>
  );
};

export default MeLayout;
