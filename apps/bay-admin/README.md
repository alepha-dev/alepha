# bay-admin

Le panneau de contrôle de [Bay](../bay/README.md) : l'UI et l'API REST par
lesquelles on déploie, redémarre, restaure. L'équivalent du dashboard
Cloudflare. C'est une app Alepha, déployée par Bay comme n'importe quelle autre.

## ⚠️ Renommée deux fois : `bay-ui` → `pulse` → `bay-admin`

Pour Bay, **le nom EST l'identité** : `--name` pilote à la fois la clé
d'instance et le sous-domaine, et il prend par défaut le `project` du manifeste,
lui-même issu du `name` du `package.json`.

Un `alepha platform up` après un renommage ne redéploie donc pas l'instance
existante : il en **crée une nouvelle**, avec une base vide — celle qui porte le
compte admin et les apps — sur un sous-domaine `bay-admin.…`, pendant que
l'ancienne continue de servir.

Avant le premier déploiement, au choix :

```bash
# Option A — déplacer l'instance (recommandé)
bay stop pulse/production
mv /opt/bay/data/apps/pulse/production /opt/bay/data/apps/bay-admin/production
# puis réécrire la clé et le `domain` dans state.json, Bay arrêté

# Option B — garder le nom historique
bay deploy bay-admin.tar.gz --name pulse --domain admin.bay.alepha.dev
```

Dans les deux cas, **épingler `--domain` explicitement** : un redéploiement
conserve le domaine d'une instance existante, mais une instance neuve prend
celui dérivé de son nom.

Vérification après bascule : `bay list` montre **une seule** instance, sur le
domaine attendu, et la page de login accepte le compte existant — preuve que la
base est bien l'ancienne.

## Ce qui appartient à bay-admin, et ce qui n'y appartient pas

bay-admin s'occupe de **l'infrastructure** : déployer, redémarrer, rollback,
backups, l'état des processus (mémoire, redémarrages, uptime) et l'historique de
cet état.

Ce qui n'y appartient pas :

- **L'analytics, les erreurs, les web-vitals** → `apps/pulse`. Pulse est
  agnostique de l'hébergement : il reçoit d'apps sur Cloudflare, sur Vercel ou
  sur Bay indifféremment. Rien dans Pulse ne doit savoir ce qu'est un
  déploiement.
- **Le suivi des incidents** → `apps/lore`.

## Pourquoi c'est une app séparée de Bay

> **Tout ce qui doit continuer à fonctionner pendant que bay-admin est cassée
> reste dans bay-go.**

bay-admin sera cassée un jour, et ce jour-là il faut encore pouvoir déployer,
redémarrer et restaurer. Donc bay-go garde le proxy, le TLS, le déploiement et
les backups ; bay-admin n'est qu'un client de son API de contrôle. Il n'y a pas
de second chemin de code : le CLI `bay` appelle exactement les mêmes endpoints.

## L'API de contrôle est un socket unix, et rien d'autre

Bay n'écoute plus sur `127.0.0.1:7717`, et `bay token` n'existe plus.

Cette API peut créer des utilisateurs unix, lire les secrets de toutes les apps
et supprimer tous les backups. Un port TCP en loopback protégé par un secret
partagé était la mauvaise forme pour ça : n'importe quel processus de la machine
atteignait le port, le secret devait vivre dans un historique de shell et une
variable d'environnement pour être utilisable, et une faute de frappe dans
l'adresse d'écoute le publiait sur internet.

L'autorisation du socket, c'est le mode du fichier, appliqué par le noyau :
l'atteindre exige déjà d'être root ou membre du groupe `bay-control`.

**L'accès distant, c'est le travail de bay-admin** : elle authentifie des
personnes, en HTTPS, et parle au socket en leur nom. C'est un système qui peut
avoir des comptes, des révocations et une trace d'audit ; un bearer token dans
une variable d'environnement n'a aucun des trois.

bay-admin reçoit l'accès au socket via `bay deploy --allow-control-api`, qui
l'ajoute au groupe `bay-control` et rend le répertoire du socket accessible en
écriture pour elle seule. Bay le journalise à chaque démarrage, parce qu'un
privilège relu une fois il y a six mois est un privilège que personne ne se
rappelle avoir accordé.

## Le navigateur ne parle jamais au socket

`BayControlService` est le seul à l'atteindre, côté serveur. Le navigateur ne
parle qu'aux `$action` de bay-admin, chacune derrière
`$secure({ roles: ["admin"] })`.

Conséquence : bay-admin n'expose que les opérations qu'elle a choisi de
réexposer. Une opération qu'elle ne forwarde pas est inatteignable depuis le
navigateur, même pour un admin authentifié.

## Amorçage

L'inscription est **fermée par défaut** — un formulaire d'inscription ouvert sur
un panneau d'infrastructure est au mieux un vecteur de spam. Deux étapes :

```bash
# 1. premier boot, inscription ouverte
PULSE_ADMIN_EMAIL=vous@example.com \
PULSE_ALLOW_REGISTRATION=true \
BAY_SOCKET=/opt/bay/data/control.sock \
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
| `BAY_SOCKET` | chemin du socket de contrôle, `<root>/control.sock` |
| `PULSE_ADMIN_EMAIL` | promue `admin` à la connexion |
| `PULSE_ALLOW_REGISTRATION` | ouvre l'inscription, pour l'amorçage seulement |

Les préfixes `PULSE_*` sont un reliquat du renommage et devront suivre.

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
