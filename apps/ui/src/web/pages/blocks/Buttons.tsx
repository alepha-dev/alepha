import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The small self-contained affordances an app shell hangs in its top bar.
 *
 * Two of the four render NOTHING until the app gives them something to choose
 * between, which is correct behaviour and a trap for a showcase: an empty
 * specimen reads as a broken component. So each states its precondition rather
 * than showing an empty box.
 */
const Buttons = () => (
  <BlockPage
    title="Buttons"
    source="@alepha/ui/components/button-dark, button-theme, button-language, brand-icon"
    description="Drop-in top-bar controls. They own their own state and take no required props, which is why the shell around this page uses the same ButtonDark you see here."
  >
    <Specimen
      title="Colour mode"
      description="ButtonDark toggles light and dark. Pass withSystem to cycle light, dark and system instead."
      inline
    >
      <ButtonDark />
      <ButtonDark withSystem />
      <ButtonDark variant="outline" />
    </Specimen>

    <Specimen
      title="Theme picker"
      description="ButtonTheme renders nothing here, and that is the component behaving correctly: it reads its list from uiThemeListAtom and hides itself when the list has fewer than two entries. This site registers no themes."
    >
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
        {`alepha.store.set(uiThemeListAtom, [
  { id: "default", label: "Default", swatch: ["#0a0a0a", "#f4f4f5"] },
  { id: "claude", label: "Claude", swatch: ["#b85434", "#f0eee6"] },
]);`}
      </pre>
    </Specimen>

    <Specimen
      title="Language picker"
      description="ButtonLanguage hides itself the same way, returning null while one dictionary or fewer is registered. This site ships English only."
    >
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
        {`export class AppI18n {
  en = $dictionary({ lazy: async () => ({ default: { ... } }) });
  de = $dictionary({ lazy: async () => ({ default: { ... } }) });
}`}
      </pre>
    </Specimen>

    <Specimen
      title="Brand icons"
      description="The identity-provider marks the auth block's social buttons use. An unknown provider falls back to a generic globe rather than rendering nothing."
      inline
    >
      <BrandIcon provider="github" className="size-6" />
      <BrandIcon provider="google" className="size-6" />
      <BrandIcon provider="apple" className="size-6" />
      <BrandIcon provider="unknown-provider" className="size-6" />
    </Specimen>
  </BlockPage>
);

export default Buttons;
