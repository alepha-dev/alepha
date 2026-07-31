import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useRouter } from "alepha/react/router";
import { AlertTriangle } from "lucide-react";
import EnrollCard from "./EnrollCard.tsx";

export interface AppsPageProps {
  apps: Array<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    ingestKeyPrefix: string;
    petitionUrl?: string;
    revokedAt?: string;
  }>;
}

/**
 * Every app reporting to this Pulse.
 *
 * Hosting is deliberately absent from this page. An app on Cloudflare and an
 * app on a VPS are the same row here — what distinguishes them is the key they
 * present, not where they run.
 */
const AppsPage = (props: AppsPageProps) => {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <EnrollCard />

      <Card>
        <CardHeader>
          <CardTitle>Apps</CardTitle>
          <CardDescription>{props.apps.length} enrolled</CardDescription>
        </CardHeader>
        <CardContent>
          {props.apps.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing enrolled yet. Create a key above, then set{" "}
              <code>PULSE_SINK</code> and <code>PULSE_KEY</code> on the app.
            </p>
          ) : (
            <div className="divide-y">
              {props.apps.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() =>
                      void router.push("app", { params: { slug: app.slug } })
                    }
                  >
                    {app.name}
                  </button>
                  <span className="text-muted-foreground text-sm">
                    {app.slug}
                  </span>
                  {app.revokedAt && (
                    <Badge variant="destructive">
                      <AlertTriangle className="size-3" />
                      Revoked
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AppsPage;
