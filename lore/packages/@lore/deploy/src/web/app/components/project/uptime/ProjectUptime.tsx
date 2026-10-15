import { type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

const ProjectUptime = () => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{tr("uptime.title")}</h1>
      <p className="text-muted-foreground">{tr("uptime.empty")}</p>
    </section>
  );
};

export default ProjectUptime;
