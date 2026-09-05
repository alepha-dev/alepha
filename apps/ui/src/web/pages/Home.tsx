import {
  Card,
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

const BLOCKS: Entry[] = [
  {
    href: "/blocks/shell",
    title: "App shell",
    description: "The frame, in three variants.",
  },
  {
    href: "/blocks/sidebar",
    title: "Sidebar",
    description: "The navigation tree.",
  },
  {
    href: "/blocks/control/text",
    title: "Control",
    description: "Text, number, date, select.",
  },
  {
    href: "/blocks/auto-form/basic",
    title: "AutoForm",
    description: "A form from a schema, nested and repeated.",
  },
  {
    href: "/blocks/table",
    title: "Table",
    description: "Server-paged and filtered.",
  },
  {
    href: "/blocks/dialog",
    title: "Dialog",
    description: "Blocking questions, as promises.",
  },
  { href: "/blocks/toast", title: "Toast", description: "Transient feedback." },
  {
    href: "/blocks/buttons",
    title: "Buttons",
    description: "Every variant and size.",
  },
];

const PAGES: Entry[] = [
  {
    href: "/pages/auth/login",
    title: "Auth",
    description: "Five screens, from sign-in to second factor.",
  },
  {
    href: "/pages/account/profile",
    title: "Account",
    description: "Five screens a person manages about themselves.",
  },
  {
    href: "/pages/admin/dashboard",
    title: "Admin",
    description: "Eleven pages, from fixtures.",
  },
];

const Home = () => {
  const router = useRouter();

  const grid = (entries: Entry[]) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((e) => (
        <Card
          key={e.href}
          className="hover:border-primary/50 cursor-pointer transition-colors"
          onClick={() => router.push(e.href)}
        >
          <CardHeader>
            <CardTitle className="text-base">{e.title}</CardTitle>
            <CardDescription>{e.description}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="w-full space-y-8 overflow-auto p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Every component, with its variants.
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          A live reference for what Alepha ships. Each page renders the real
          component, so what you see is what the current build does. No
          database, no auth: the data-driven blocks are fed by a handful of
          actions over in-memory arrays.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Blocks</h2>
        {grid(BLOCKS)}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Pages</h2>
        {grid(PAGES)}
      </section>
    </div>
  );
};

export default Home;
