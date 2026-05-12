import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, Heart, Home, RotateCw } from "lucide-react";
import type { I18n } from "../../services/I18n.ts";

const ErrorPage = () => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="text-muted-foreground">
          <Heart className="size-12" />
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="text-lg font-bold">{tr("error.title")}</span>
          <span className="text-muted-foreground text-sm">
            {tr("error.description")}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="size-4" />
            {tr("error.back")}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCw className="size-4" />
            {tr("error.reload")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            <Home className="size-4" />
            {tr("error.home")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;
