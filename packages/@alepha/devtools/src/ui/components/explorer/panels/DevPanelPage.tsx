import { Badge } from "@alepha/ui/components/ui/badge";
import { Card } from "@alepha/ui/components/ui/card";

interface DevPanelPageProps {
  page: any;
}

export const DevPanelPage = (props: DevPanelPageProps) => {
  const page = props.page;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 text-lg font-semibold">{page.label || page.name}</p>
        {page.path && (
          <code className="bg-muted mb-1 rounded px-1.5 py-0.5 text-sm">
            {page.path}
          </code>
        )}
        {page.description && (
          <p className="text-muted-foreground text-sm">{page.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {page.hasLazy && <Badge variant="secondary">Lazy</Badge>}
        {page.hasParent && (
          <Badge variant="secondary">Parent: {page.parentName ?? "?"}</Badge>
        )}
        {page.hasChildren && <Badge variant="secondary">Children</Badge>}
        {page.hasErrorHandler && (
          <Badge variant="destructive">Error Handler</Badge>
        )}
        {page.hasResolve && <Badge variant="secondary">Loader</Badge>}
        {page.client && <Badge variant="secondary">Client Only</Badge>}
        {page.static && <Badge variant="secondary">Static</Badge>}
      </div>

      {page.params && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
            Path Parameters
          </p>
          <Card className="p-3">
            <pre className="overflow-auto text-xs">
              {JSON.stringify(page.params, null, 2)}
            </pre>
          </Card>
        </div>
      )}

      {page.query && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
            Query Parameters
          </p>
          <Card className="p-3">
            <pre className="overflow-auto text-xs">
              {JSON.stringify(page.query, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
};
