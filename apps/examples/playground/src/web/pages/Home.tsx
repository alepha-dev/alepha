import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { LogIn, Shield, UserPlus } from "lucide-react";

import type { PlaygroundI18n } from "../PlaygroundI18n.ts";

const Home = () => {
  const [user] = useStore(currentUserAtom);
  const router = useRouter();
  const { tr } = useI18n<PlaygroundI18n, "en">();

  if (!user) {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>{tr("home.welcome")}</CardTitle>
            <CardDescription>{tr("home.signedOut")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => router.push("/auth/login")}>
              <LogIn className="mr-1 size-4" />
              {tr("home.signIn")}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/auth/register")}
            >
              <UserPlus className="mr-1 size-4" />
              {tr("home.register")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdmin = user.roles?.includes("admin");

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {tr("home.signedIn", { args: [user.name ?? user.email ?? ""] })}
          </CardTitle>
          <CardDescription>
            <code className="bg-muted rounded px-1 py-0.5">{user.email}</code> ·
            roles{" "}
            <code className="bg-muted rounded px-1 py-0.5">
              {(user.roles ?? []).join(", ") || "user"}
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button onClick={() => router.push("/admin/users")}>
              <Shield className="mr-1 size-4" />
              {tr("home.openAdmin")}
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push("/demo/forms")}>
            {tr("home.demoGallery")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Home;
