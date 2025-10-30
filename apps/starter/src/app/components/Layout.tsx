import { Link, NestedView, useActive, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import type { ReactNode } from "react";
import type { AppI18n } from "../AppI18n.ts";
import type { AppRouter } from "../AppRouter.ts";

const Layout = () => {
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<AppI18n, "en">();
  return (
    <div>
      <LanguageSwitcher />
      <fieldset>
        <legend>{tr("home.title")}</legend>
        <ul>
          <li>
            <MenuItem href={router.path("home")}>{tr("nav.home")}</MenuItem>
          </li>
          <li>
            <MenuItem href={router.path("taskCreate")}>
              {tr("nav.addTask")}
            </MenuItem>
          </li>
        </ul>
        <NestedView />
      </fieldset>
    </div>
  );
};

export default Layout;

// --

const MenuItem = (props: { href: string; children: ReactNode }) => {
  const { anchorProps, isActive } = useActive(props.href);
  return (
    <Link {...anchorProps} className={isActive ? "active" : ""}>
      {props.children}
    </Link>
  );
};

const LanguageSwitcher = () => {
  const { lang, setLang } = useI18n<AppI18n, "en">();

  const onSetLang = (key: string) => {
    return async () => {
      await setLang(key);
    };
  };

  return (
    <div>
      <button disabled={lang === "en"} type="button" onClick={onSetLang("en")}>
        En
      </button>
      <button disabled={lang === "fr"} type="button" onClick={onSetLang("fr")}>
        Fr
      </button>
    </div>
  );
};
