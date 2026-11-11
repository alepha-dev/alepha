import HeaderActions from "../shared/header/HeaderActions.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

/**
 * The welcome page's header band, drawn like `HomeHeader` on the board: the
 * mark and the product name on the left, the settings and sign-in on the
 * right, over the page's top rule.
 */
const HomeWelcomeHeader = () => {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-8">
      <LoreLogo size={22} className="size-[22px]" />
      <span className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
        Alepha Lore
      </span>
      <span className="flex-1" />
      <HeaderActions />
    </header>
  );
};

export default HomeWelcomeHeader;
