# pulse

Le panneau de contrôle de [Bay](../bay/README.md), et le récepteur de la
télémétrie des apps enrôlées — une app Alepha, déployée par Bay comme n'importe
quelle autre.

## ⚠️ Renommée depuis `bay-ui` : la première mise à jour est une migration

Cette app s'appelait `bay-ui`. Pour Bay, **le nom EST l'identité** : `--name`
pilote à la fois la clé d'instance et le sous-domaine, et il prend par défaut le
`project` du manifeste, lui-même issu du `name` du `package.json`.

Un `alepha platform up` après le renommage ne redéploie donc pas l'instance
existante : il en **crée une nouvelle**, avec une base vide — celle qui porte les
apps enrôlées, les hash de clés d'ingest et le compte admin — sur un
sous-domaine `pulse.…`, pendant que l'ancienne continue de servir.

Avant le premier déploiement, au choix :

```bash
# Option A — déplacer l'instance (recommandé)
bay stop bay-ui/production
mv /opt/bay/data/apps/bay-ui/production /opt/bay/data/apps/pulse/production
# puis réécrire la clé et le `domain` dans state.json, Bay arrêté

# Option B — garder le nom historique
bay deploy pulse.tar.gz --name bay-ui --domain admin.example.com
```

Dans les deux cas, **épingler `--domain` explicitement** : un redéploiement
conserve le domaine d'une instance existante, mais une instance neuve prend
celui dérivé de son nom.

Vérification après bascule : `bay list` montre **une seule** instance, sur le
domaine attendu, et la page de login accepte le compte existant — preuve que la
base est bien l'ancienne.

## Pourquoi c'est une app séparée

> **Tout ce qui doit continuer à fonctionner pendant que pulse est cassée reste
> dans bay-go.**

pulse sera cassée un jour, et ce jour-là il faut encore pouvoir déployer,
redémarrer et restaurer. Donc bay-go garde le proxy, le TLS, le déploiement et
les backups ; pulse n'est qu'un client de son API de contrôle. Il n'y a pas de
second chemin de code : le CLI `bay` appelle exactement les mêmes endpoints.

## Le token ne va jamais dans le navigateur

L'API de contrôle est équivalente à root — elle déploie du code, lit des secrets
et peut supprimer tous les backups. `BAY_TOKEN` vit donc **uniquement** dans
`BayControlService`, côté serveur, et le navigateur ne parle qu'aux `$action` de
pulse, chacun derrière `$secure({ roles: ["admin"] })`.

Conséquence : pulse n'expose que les opérations qu'elle a choisi de réexposer.
Une opération qu'elle ne forwarde pas est inatteignable depuis le navigateur,
même pour un admin authentifié.

## Amorçage

L'inscription est **fermée par défaut** — un formulaire d'inscription ouvert sur
un panneau d'infrastructure est au mieux un vecteur de spam. Deux étapes :

```bash
# 1. premier boot, inscription ouverte
PULSE_ADMIN_EMAIL=vous@example.com \
PULSE_ALLOW_REGISTRATION=true \
BAY_URL=http://127.0.0.1:7717 BAY_TOKEN=$(bay token) \
  node dist

# 2. créez le compte sur /auth/register, puis retirez le flag et redéployez
```

`PULSE_ALLOW_REGISTRATION` ne gouverne **que** l'inscription. L'autorisation
n'en dépend pas : chaque endpoint exige le rôle `admin`, et c'est
`PULSE_ADMIN_EMAIL` qui l'accorde — à la connexion, à la seule adresse
déclarée. Un compte créé par quelqu'un d'autre ne peut rien faire.

⚠️ `PULSE_ALLOW_REGISTRATION` est un booléen : le framework n'accepte que
`true` / `false` littéraux pour un booléen d'environnement. `=1` fait échouer le
démarrage (bruyamment, avec le nom de la variable).

## Variables

| | |
|---|---|
| `BAY_URL` | base de l'API de contrôle, `http://127.0.0.1:7717` par défaut |
| `BAY_TOKEN` | sortie de `bay token`. **Équivalent root.** |
| `PULSE_ADMIN_EMAIL` | promue `admin` à la connexion |
| `PULSE_ALLOW_REGISTRATION` | ouvre l'inscription, pour l'amorçage seulement |

## En phase 1, pulse tourne sur la machine du dev

Elle ne s'auto-héberge pas encore. L'API de contrôle reste sur loopback et on
l'atteint par un **tunnel SSH** :

```bash
ssh -L 7717:127.0.0.1:7717 ovh-bay
```

Ça n'ajoute aucune surface d'attaque, là où exposer le port demanderait ensuite
de le défendre. Sans cette simplification il faudrait résoudre « qui déploie
pulse » avant d'avoir déployé quoi que ce soit.

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
