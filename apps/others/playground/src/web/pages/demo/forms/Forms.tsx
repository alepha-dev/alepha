import { Link } from "alepha/react/router";
import {
  Calendar,
  CreditCard,
  KeyRound,
  ListChecks,
  MapPin,
  Upload,
  UserPlus,
} from "lucide-react";

const cards = [
  { href: "/demo/forms/login", title: "Login", icon: KeyRound },
  { href: "/demo/forms/register", title: "Register", icon: UserPlus },
  { href: "/demo/forms/address", title: "Address", icon: MapPin },
  { href: "/demo/forms/payment", title: "Payment", icon: CreditCard },
  { href: "/demo/forms/selects", title: "Select variants", icon: ListChecks },
  { href: "/demo/forms/upload", title: "File upload", icon: Upload },
  { href: "/demo/forms/dates", title: "Date / time", icon: Calendar },
];

const FormsIndex = () => (
  <div className="container mx-auto max-w-3xl p-6">
    <h1 className="text-2xl font-semibold mb-2">Form gallery</h1>
    <p className="text-muted-foreground mb-6 text-sm">
      A collection of typical AutoForm use cases. Each one exercises a different
      combination of $control options, autocomplete tokens, and ControlSelect
      variants.
    </p>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {cards.map(({ href, title, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="bg-muted/30 hover:bg-muted/60 flex flex-col items-center gap-2 rounded-md border p-4 transition"
        >
          <Icon className="size-6" />
          <span className="text-sm font-medium">{title}</span>
        </Link>
      ))}
    </div>
  </div>
);

export default FormsIndex;
