import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useRouter } from "alepha/react/router";

interface Entry {
  href: string;
  title: string;
  description: string;
}

const ENTRIES: Entry[] = [
  {
    href: "/blocks/table",
    title: "AlephaTable",
    description:
      "Server-paged and static tables, with filters, sorting and a column picker.",
  },
  {
    href: "/blocks/controls",
    title: "Controls",
    description:
      "The Control family: text, number, password, select, date, array and object.",
  },
  {
    href: "/blocks/auto-form",
    title: "AutoForm",
    description:
      "A whole form derived from a zod schema, conditionals and all.",
  },
  {
    href: "/blocks/feedback",
    title: "Toasts and dialogs",
    description:
      "useToast and the imperative useDialog API that replaces window.confirm.",
  },
  {
    href: "/blocks/buttons",
    title: "Buttons",
    description: "Theme, language and brand affordances for an app shell.",
  },
  {
    href: "/blocks/select",
    title: "Select",
    description:
      "Every shape one control takes: segmented, searchable, async, clearable.",
  },
  {
    href: "/blocks/shell",
    title: "App shell",
    description: "The three layouts, and the sidebar that goes in them.",
  },
  {
    href: "/blocks/auth",
    title: "Auth & account",
    description: "Sign in, register, reset, and the account settings pages.",
  },
];

const Home = () => {
  const router = useRouter();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
      <header className="space-y-3">
        <Badge variant="secondary">@alepha/ui</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Every component, with its variants.
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          A live reference for the components Alepha ships. Each page renders
          the real component, not a screenshot, so what you see here is what the
          current build does.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ENTRIES.map((entry) => (
          <Card
            key={entry.href}
            className="hover:border-primary/50 cursor-pointer transition-colors"
            onClick={() => router.push(entry.href)}
          >
            <CardHeader>
              <CardTitle className="text-base">{entry.title}</CardTitle>
              <CardDescription>{entry.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">No backend</CardTitle>
          <CardDescription>
            This site ships no database, no migrations and no auth. The blocks
            that normally talk to a server are fed by a handful of actions over
            an in-memory dataset, so every screen is the real component with
            real data, and nothing here can be signed into.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Source lives in the Alepha monorepo under{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
            apps/ui
          </code>
          .
        </CardContent>
      </Card>
    </div>
  );
};

export default Home;
