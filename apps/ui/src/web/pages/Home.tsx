import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { Button } from "@alepha/ui/components/ui/button";
import { useAlepha } from "alepha/react";
import { Link } from "alepha/react/router";
import { ArrowUpRight } from "lucide-react";

import { NavPaletteField } from "../components/NavPaletteField.tsx";

const GITHUB_URL = "https://github.com/alepha-dev/alepha";

/**
 * The title page of the showcase.
 *
 * ⚠️ Left-aligned and set against the shell's own left edge, not centred. Every
 * other page here opens with a heading in that column, and the sidebar's items
 * sit on the same axis, so a centred hero would be the one thing on the site
 * that floats free of it. The space to the right is the composition, not a gap
 * waiting for a card grid.
 *
 * There is no index of blocks below, on purpose. The sidebar already lists
 * every one of them and never scrolls away, and the field at the bottom opens
 * the same list as a palette - a grid of cards would be the third copy.
 *
 * Nothing here is a mock-up: the version is the build's own, and the field is a
 * live palette over the real routes. That is the whole claim the page makes, so
 * it had better be true on the page that makes it.
 */
const Home = () => {
  const alepha = useAlepha();

  return (
    <div className="flex h-full w-full flex-col overflow-auto p-8 md:p-12 lg:p-16">
      <div className="my-auto w-full max-w-2xl">
        <a
          href="https://alepha.dev/changelog?scope=ui"
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:border-ring/60 hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-2.5 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
        >
          {/*
            The build stamp, not an announcement: it names the version every
            specimen on this site is rendered from. `meta.version` is the
            framework's, which is what `alepha.config.ts` sets it to.
          */}
          <span className="font-mono">v{alepha.meta.version}</span>
          <span className="bg-border h-3 w-px" aria-hidden />
          <span>Changelog</span>
          <ArrowUpRight className="size-3" aria-hidden />
        </a>

        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Blocks for complex &amp; professional use cases.
        </h1>

        <p className="text-muted-foreground mt-5 text-lg">
          Made for{" "}
          <a
            href="https://alepha.dev"
            target="_blank"
            rel="noreferrer"
            className="text-foreground decoration-muted-foreground/50 hover:decoration-foreground underline underline-offset-4 transition-colors"
          >
            Alepha
          </a>
          .
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/blocks/shell" />}
          >
            Get started
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<a href={GITHUB_URL} target="_blank" rel="noreferrer" />}
          >
            <BrandIcon provider="github" />
            GitHub
          </Button>
        </div>

        <NavPaletteField className="mt-12 max-w-md" />
      </div>
    </div>
  );
};

export default Home;
