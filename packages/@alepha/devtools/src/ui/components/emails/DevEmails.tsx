import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface EmailEntry {
  to: string;
  subject: string;
  body: string;
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

export const DevEmails = () => {
  const http = useInject(HttpClient);
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const fetchEmails = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await http.fetch("/__devtools/api/emails");
      const data = res.data as any;
      setEmails(data?.emails ?? []);
    } catch {
      // silently fail
    }
  }, [http]);

  useEffect(() => {
    fetchEmails();
    const interval = setInterval(fetchEmails, 10_000);
    return () => clearInterval(interval);
  }, [fetchEmails]);

  const filtered = emails.filter((email) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      email.to.toLowerCase().includes(q) ||
      email.subject.toLowerCase().includes(q)
    );
  });

  const selectedEmail = selectedIndex !== null ? filtered[selectedIndex] : null;

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
        <Badge variant="secondary">{filtered.length} emails</Badge>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto">
          {filtered.length === 0 && (
            <div className="text-muted-foreground flex items-center justify-center py-8">
              <p className="text-sm">No emails to display</p>
            </div>
          )}
          {filtered.map((email, i) => {
            const isSelected = selectedIndex === i;
            return (
              <button
                type="button"
                key={`${email.sentAt}-${i}`}
                onClick={() => setSelectedIndex(isSelected ? null : i)}
                className={`border-border/20 flex flex-col border-b px-4 py-2 text-left transition-colors ${
                  isSelected ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm">{email.to}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {formatRelative(email.sentAt)}
                  </span>
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {email.subject}
                </span>
              </button>
            );
          })}
        </div>

        {selectedEmail && (
          <div className="border-border flex w-[500px] shrink-0 flex-col overflow-hidden border-l">
            <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2">
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Email Detail
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
                <Section label="To" value={selectedEmail.to} />
                <Section
                  label="Date"
                  value={formatDate(selectedEmail.sentAt)}
                />
                <Section label="Subject" value={selectedEmail.subject} />
                <div className="flex flex-col">
                  <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                    Body
                  </p>
                  <div
                    className="rounded border bg-white p-3 text-[#333]"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: devtools renders developer's own email HTML
                    dangerouslySetInnerHTML={{ __html: selectedEmail.body }}
                  />
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

export default DevEmails;
