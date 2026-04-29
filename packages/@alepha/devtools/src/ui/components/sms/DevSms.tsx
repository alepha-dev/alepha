import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface SmsEntry {
  to: string;
  message: string;
  sentAt: string;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString();
};

const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

export const DevSms = () => {
  const http = useInject(HttpClient);
  const [messages, setMessages] = useState<SmsEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const fetchMessages = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await http.fetch("/__devtools/api/sms");
      const data = res.data as any;
      setMessages(data?.messages ?? []);
    } catch {
      // silently fail
    }
  }, [http]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 10_000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const filtered = messages.filter((sms) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      sms.to.toLowerCase().includes(q) || sms.message.toLowerCase().includes(q)
    );
  });

  const selectedSms = selectedIndex !== null ? filtered[selectedIndex] : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search..."
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <Badge variant="secondary">{filtered.length} messages</Badge>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto">
          {filtered.length === 0 && (
            <div className="text-muted-foreground flex items-center justify-center py-8">
              <p className="text-sm">No messages to display</p>
            </div>
          )}
          {filtered.map((sms, i) => {
            const isSelected = selectedIndex === i;
            return (
              <button
                type="button"
                key={`${sms.sentAt}-${i}`}
                onClick={() => setSelectedIndex(isSelected ? null : i)}
                className={`border-border/20 flex flex-col border-b px-4 py-2 text-left transition-colors ${
                  isSelected ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm">{sms.to}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {formatRelative(sms.sentAt)}
                  </span>
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {sms.message}
                </span>
              </button>
            );
          })}
        </div>

        {selectedSms && (
          <div className="border-border flex w-[400px] shrink-0 flex-col overflow-hidden border-l">
            <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2">
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Message Detail
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIndex(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="flex flex-col gap-4">
                <Section label="To" value={selectedSms.to} />
                <Section label="Date" value={formatDate(selectedSms.sentAt)} />
                <div className="flex flex-col">
                  <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                    Message
                  </p>
                  <p className="whitespace-pre-wrap text-xs">
                    {selectedSms.message}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface SectionProps {
  label: string;
  value: string;
}

const Section = (props: SectionProps) => (
  <div className="flex flex-col">
    <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
      {props.label}
    </p>
    <p className="text-xs">{props.value}</p>
  </div>
);

export default DevSms;
