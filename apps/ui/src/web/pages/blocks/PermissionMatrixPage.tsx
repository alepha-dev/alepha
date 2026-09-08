import { PermissionMatrix } from "@alepha/ui/components/permission-matrix/permission-matrix";
import type { PermissionMatrixGroup } from "@alepha/ui/components/permission-matrix/permission-matrix";
import { Card } from "@alepha/ui/components/ui/card";
import { z } from "alepha";
import { AppWindow, FolderClosed, Swords } from "lucide-react";
import { useState } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The matrix on its own, with the three things a consumer has to decide.
 *
 * The knobs are the props that are easy to get wrong rather than every prop
 * there is: whether a rank column is offered read-only, whether a group is
 * passed at all (which is how an application hides a subject the reader's
 * installation does not have), and whether the whole table is inert.
 *
 * The copy is French on purpose. The component ships no strings, and the
 * quickest way to keep it that way is a showcase in a language nobody would
 * reach for a hardcoded default in.
 */
const KNOBS = z.object({
  owner: z.boolean().default(true).meta({ title: "Colonne propriétaire" }),
  apps: z.boolean().default(true).meta({ title: "Groupe Applications" }),
  disabled: z.boolean().default(false).meta({ title: "Lecture seule" }),
});

/**
 * Two groups, one of them optional, and the two kinds of locked row.
 *
 * `projet:lire` is a floor and `projet:supprimer` a ceiling, which is what
 * makes the owner column worth looking at: it reads all-on across both, where
 * every other column reads the lock.
 */
const CORE: PermissionMatrixGroup = {
  key: "projet",
  label: "Projet",
  icon: FolderClosed,
  permissions: [
    {
      name: "projet:lire",
      label: "Consulter le projet",
      description: "Tout le monde, toujours.",
      lock: "on",
    },
    { name: "projet:modifier", label: "Modifier le projet" },
    {
      name: "projet:supprimer",
      label: "Supprimer le projet",
      description: "Réservé au propriétaire, jamais accordé.",
      lock: "off",
    },
  ],
};

const APPS: PermissionMatrixGroup = {
  key: "app",
  label: "Applications",
  icon: AppWindow,
  permissions: [
    { name: "app:lire", label: "Voir les applications" },
    { name: "app:gerer", label: "Gérer les applications" },
    { name: "app:deployer", label: "Déployer une application" },
  ],
};

/**
 * A third group, always shown, so the coverage bars have enough rows to say
 * something. With two groups every ratio was a small fraction of a small
 * number and the bars all looked alike.
 */
const QUESTS: PermissionMatrixGroup = {
  key: "quete",
  label: "Quêtes",
  icon: Swords,
  permissions: [
    { name: "quete:lire", label: "Consulter les quêtes", lock: "on" },
    { name: "quete:creer", label: "Créer une quête" },
    { name: "quete:assigner", label: "Assigner une quête" },
    { name: "quete:supprimer", label: "Supprimer une quête" },
  ],
};

const PermissionMatrixPage = () => {
  const [value, setValue] = useState<Record<string, string[]>>({
    admin: [
      "projet:modifier",
      "app:lire",
      "app:gerer",
      "app:deployer",
      "quete:creer",
      "quete:assigner",
      "quete:supprimer",
    ],
    contributeur: ["app:lire", "quete:creer", "quete:assigner"],
    lecteur: [],
  });

  return (
    <Showcase
      id="blocks/PermissionMatrixPage"
      title="Permission matrix"
      description="Permissions down the left, one column per rank, a checkbox at each crossing."
      schema={KNOBS}
      initialValues={{ owner: true, apps: true, disabled: false }}
    >
      {(v) => (
        <Card className="p-0">
          <PermissionMatrix
            header="Permission"
            empty="Aucune permission à afficher."
            disabled={v.disabled}
            // Filtering is the caller's job, and this is what that looks like:
            // a group the installation does not have is simply not in the
            // array. The component is never told why.
            groups={v.apps ? [CORE, APPS, QUESTS] : [CORE, QUESTS]}
            columns={[
              ...(v.owner
                ? [
                    {
                      key: "proprietaire",
                      label: "Propriétaire",
                      // The caller's half of the line under the name. The
                      // component appends the coverage ratio to it.
                      description: "1 membre",
                      readOnly: true,
                    },
                  ]
                : []),
              { key: "admin", label: "Admin", description: "2 membres" },
              {
                key: "contributeur",
                label: "Contributeur",
                description: "9 membres",
              },
              { key: "lecteur", label: "Lecteur", description: "4 membres" },
            ]}
            value={value}
            onChange={setValue}
          />
        </Card>
      )}
    </Showcase>
  );
};

export default PermissionMatrixPage;
