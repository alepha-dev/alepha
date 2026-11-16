import LoreLogo from "../shared/LoreLogo.tsx";

/**
 * The brand above the auth forms (sign in, register, reset password): the
 * floating mark, and under it the product name set as the header sets it,
 * small caps-like and widely tracked, so a visitor arriving straight on a
 * form knows where they are.
 */
const AuthBrand = () => {
  return (
    <div className="flex flex-col items-center gap-3">
      <LoreLogo size={64} className="animate-floating size-16" />
      <span className="text-muted-foreground text-xs tracking-[0.22em] uppercase">
        Alepha Lore
      </span>
    </div>
  );
};

export default AuthBrand;
