import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";

export interface ErrorsViewProps {
  errors: Array<{
    fingerprint: string;
    name: string;
    message: string;
    sourceUrl: string;
    origin: string;
    release?: string;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
}

/**
 * Distinct failures, most recent first.
 *
 * One row per fingerprint, not per occurrence. Stack frames are normalized
 * before hashing — bundle hashes and `:line:column` removed — so the same
 * fault stays one group across deploys instead of appearing as new on every
 * release.
 */
const ErrorsView = (props: ErrorsViewProps) => {
  if (props.errors.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>Nothing has failed yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {props.errors.map((error) => (
        <Card key={error.fingerprint}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono">{error.name}</span>
              <Badge variant={error.count > 10 ? "destructive" : "secondary"}>
                {error.count}×
              </Badge>
              <Badge variant="outline">{error.origin}</Badge>
              {error.release && (
                <Badge variant="outline">{error.release}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-sm">{error.message}</p>
            {error.sourceUrl && (
              <p className="text-muted-foreground truncate font-mono text-xs">
                {error.sourceUrl}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              first {new Date(error.firstSeenAt).toLocaleString()} · last{" "}
              {new Date(error.lastSeenAt).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default ErrorsView;
