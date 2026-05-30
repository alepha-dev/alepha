import { Button } from "@alepha/ui/components/ui/button";
import { useAuth } from "alepha/react/auth";
import { Link, NestedView, useRouter } from "alepha/react/router";
import { Home, User } from "lucide-react";
import type { AppRouter } from "../../../AppRouter.ts";
import { displayName } from "../../../services/displayName.ts";
import { publicFileUrl } from "../../../services/fileUrl.ts";
import PageHeader from "../../shared/header/PageHeader.tsx";
import MeLayoutMenu from "./MeLayoutMenu.tsx";

const MeLayout = () => {
  const auth = useAuth();
  const router = useRouter<AppRouter>();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-auto p-4">
      <PageHeader />
      {/* Compact header */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-card p-4">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
          {auth.user?.picture ? (
            <img
              src={publicFileUrl(auth.user.picture)}
              alt="avatar"
              className="size-full object-cover"
            />
          ) : (
            <User className="size-5" />
          )}
        </div>
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
