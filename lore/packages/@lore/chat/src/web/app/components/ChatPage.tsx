import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { MessagesSquare } from "lucide-react";

/**
 * The Chat page (#E161), empty until the rooms land: the inbox and the
 * conversation of layout C come with the page quest.
 */
const ChatPage = () => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <MessagesSquare className="text-muted-foreground size-8" />
      <h1 className="text-lg font-medium">{tr("chat.page.empty.title")}</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        {tr("chat.page.empty.description")}
      </p>
    </div>
  );
};

export default ChatPage;
