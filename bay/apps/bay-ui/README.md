# bay-ui

Le panneau de contrôle de [Bay](../bay/README.md) — une app Alepha, déployée par
Bay comme n'importe quelle autre.

## Pourquoi c'est une app séparée

> **Tout ce qui doit continuer à fonctionner pendant que bay-ui est cassée reste
> dans bay-go.**

bay-ui sera cassée un jour, et ce jour-là il faut encore pouvoir déployer,
redémarrer et restaurer. Donc bay-go garde le proxy, le TLS, le déploiement et
les backups ; bay-ui n'est qu'un client de son API de contrôle. Il n'y a pas de
second chemin de code : le CLI `bay` appelle exactement les mêmes endpoints.

## Le token ne va jamais dans le navigateur

L'API de contrôle est équivalente à root — elle déploie du code, lit des secrets
et peut supprimer tous les backups. `BAY_TOKEN` vit donc **uniquement** dans
`BayControlService`, côté serveur, et le navigateur ne parle qu'aux `$action` de
bay-ui, chacun derrière `$secure({ roles: ["admin"] })`.

Conséquence : bay-ui n'expose que les opérations qu'elle a choisi de réexposer.
Une opération qu'elle ne forwarde pas est inatteignable depuis le navigateur,
même pour un admin authentifié.

## Amorçage

L'inscription est **fermée par défaut** — un formulaire d'inscription ouvert sur
un panneau d'infrastructure est au mieux un vecteur de spam. Deux étapes :

```bash
# 1. premier boot, inscription ouverte
BAY_UI_ADMIN_EMAIL=vous@example.com \
BAY_UI_ALLOW_REGISTRATION=true \
BAY_URL=http://127.0.0.1:7717 BAY_TOKEN=$(bay token) \
  node dist

# 2. créez le compte sur /auth/register, puis retirez le flag et redéployez
```

`BAY_UI_ALLOW_REGISTRATION` ne gouverne **que** l'inscription. L'autorisation
n'en dépend pas : chaque endpoint exige le rôle `admin`, et c'est
`BAY_UI_ADMIN_EMAIL` qui l'accorde — à la connexion, à la seule adresse
déclarée. Un compte créé par quelqu'un d'autre ne peut rien faire.

⚠️ `BAY_UI_ALLOW_REGISTRATION` est un booléen : le framework n'accepte que
`true` / `false` littéraux pour un booléen d'environnement. `=1` fait échouer le
démarrage (bruyamment, avec le nom de la variable).

## Variables

| | |
|---|---|
| `BAY_URL` | base de l'API de contrôle, `http://127.0.0.1:7717` par défaut |
| `BAY_TOKEN` | sortie de `bay token`. **Équivalent root.** |
| `BAY_UI_ADMIN_EMAIL` | promue `admin` à la connexion |
| `BAY_UI_ALLOW_REGISTRATION` | ouvre l'inscription, pour l'amorçage seulement |

## En phase 1, bay-ui tourne sur la machine du dev

Elle ne s'auto-héberge pas encore. L'API de contrôle reste sur loopback et on
l'atteint par un **tunnel SSH** :

```bash
ssh -L 7717:127.0.0.1:7717 ovh-bay
```

Ça n'ajoute aucune surface d'attaque, là où exposer le port demanderait ensuite
de le défendre. Sans cette simplification il faudrait résoudre « qui déploie
bay-ui » avant d'avoir déployé quoi que ce soit.

## Pièges rencontrés en la construisant

**Les blocs de `@alepha/ui` exigent des modules qu'ils ne déclarent pas.**
`DialogProvider` appelle `useI18n()`, `AuthLogin` / `AuthRegister` appellent
`useAuth()`. Il faut donc importer `AlephaReactI18n` et `AlephaReactAuth` même
pour une app monolingue. Et ils le font **au rendu ou à la soumission**, pas au
boot : l'absence sort en `ContainerLockedError` dans un formulaire déjà soumis,
pas en échec de démarrage.

**Tailwind v4 a besoin de son plugin Vite.** Sans `vite.config.ts` déclarant
`tailwindcss()`, le build réussit, la feuille de style se charge en 200 — et ne
contient aucune utilitaire. Toute l'app rend sans style. Un échec parfaitement
silencieux.

**`z.file()` donne un `FileLike`, pas un `Blob` natif.** Le passer directement
comme `body` à `fetch` le sérialise en `[object Object]`, et Bay répond
`not a gzip archive: gzip: invalid header` — une erreur qui accuse l'artefact
alors que l'artefact était bon. Lire les octets avec `arrayBuffer()`.

**Ne jamais étiqueter une réponse d'erreur comme une panne de transport.** Le
premier jet enveloppait tout échec de `fetch` en « Bay unreachable », y compris
un 400 : ça envoie vérifier le tunnel quand le vrai problème est l'artefact
uploadé. `HttpError` est réémis tel quel, seul un vrai échec de connexion dit
« unreachable ».

**`children` d'un `$page` doit être un thunk.** Les initialiseurs de champs
s'exécutent de haut en bas, donc `children: [this.home]` capture `undefined`.
