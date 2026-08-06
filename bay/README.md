# Bay — PoC

Serveur d'applications self-hosted pour apps Alepha. Design complet dans le
folio **Bay** de la campagne Lore « Alepha ».

Ce PoC prouve la tranche verticale : **un `app.zip` entre, une URL HTTPS sort.**

> Installing Bay on a real host: **[INSTALL.md](./INSTALL.md)**. The install itself is four steps;
> granting a user the right to deploy over SSH is a fifth, and it is the one that produces every
> confusing first-deploy failure — an empty `bay-control` group, a `bay` missing from the
> non-interactive PATH, and a host binary too old to read the artifact from stdin.

## Ce qui est dedans

| | |
|---|---|
| Reverse proxy | routage par `Host`, *file-first / fallback app* |
| Assets statiques | servis depuis **toutes les releases conservées**, négociation `.br`/`.gz`, cache immuable sur les noms hashés |
| Déploiement | dézippage (avec garde zip-slip), lecture du manifest, bascule atomique de `current` |
| Provisioning | fichier SQLite, `APP_SECRET` stable, `.env` en `0600` écrit atomiquement |
| Supervision | démarrage/arrêt, arrêt gracieux (SIGTERM puis SIGKILL), groupe de process |
| État | un fichier JSON, écrit `temp + rename`, avec `.bak` |
| API de contrôle | HTTP sur loopback, token porteur obligatoire |
| CLI | client fin de cette même API — **un seul contrat** |

| TLS / ACME | CertMagic, testable **sans domaine public ni root** via Pebble |
| Observabilité | `bay status`, `bay logs` — rien n'est stocké |

## Observer une app, sans rien stocker

Deux commandes, aucune série temporelle, aucun job, aucune table. C'est
délibéré : une base de séries qu'il faut administrer, purger et sauvegarder pour
répondre à deux questions fixes coûte plus cher que les réponses.

```bash
bay status --json            # up, redémarrages, trafic, fraîcheur des backups
bay logs lore/production --since 15m --grep 'ECONN' --json
```

**`bay logs` sort du JSON Lines.** Son lecteur principal est un agent en SSH, pas
un œil : `--json`, `--since`, `--grep` (une expression régulière). Sur un vrai
hôte les entrées viennent de journald, qui apporte sa propre rétention ; sous le
runner enfant elles viennent de `logs/app.log`, qui est tourné à 32 Mio.

⚠️ `--since` **conserve** les lignes sans horodatage et l'annonce en fin de
sortie. Une app qui écrit du texte brut sur stdout n'en produit aucun, et les
masquer supprimerait exactement le `console.log` qu'on vient d'ajouter.

## What backups cover, and what they do not

**The database, and nothing else.**

| | |
|---|---|
| SQLite database | ✅ snapshot through SQLite's own backup API, verified, then compressed |
| `storage/` (uploads) | ❌ **never** — see below |
| `.env` | ❌ **never** — secrets come from the deployment |

Every backup response says what it did not cover, in words. The worst failure of
a backup system is somebody believing it covers more than it does, and that
belief is cheapest to prevent at the moment they run the command.

### Why uploads are not archived

Bay used to tar `storage/` nightly. That looked like protection and was not:

- **nothing could restore it** — `bay restore` puts the database back and says
  `notRestored: ["storage/"]`;
- **nothing pruned it** — retention only ever walked the `db/` prefix, so the
  archives grew in the bucket forever;
- **it was capped by RAM** — the whole tar was held in memory, so it refused
  anything over 1 GiB and an app that grew past that silently had no coverage.

A one-directional, unprunable, memory-bound copy is not a backup. So uploads are
shared by putting them **in a bucket**, or they are not shared at all:

```bash
bay config s3:apps --endpoint URL --bucket NAME   # a SECOND credential, never the backup one
bay storage migrate <name/env>                    # copies what is on disk, keeps the originals
```

An app left on local storage keeps its files in exactly one place, on this
host's disk. `bay backup` says so every time rather than letting silence imply
otherwise.

⚠️ A bucket is durable, not point-in-time: deleting the wrong key deletes it
everywhere. **Enable versioning on the storage bucket.**

## Tester ACME sans domaine

Pebble est le serveur ACME de test de Let's Encrypt. Il fait tourner le vrai
RFC 8555 en local : création de compte, commande, challenge, émission,
renouvellement (ARI compris).

```bash
GOBIN=/tmp/baybin go install github.com/letsencrypt/pebble/v2/cmd/pebble@latest
GOBIN=/tmp/baybin go install github.com/letsencrypt/pebble/v2/cmd/pebble-challtestsrv@latest

BAY_PEBBLE_BIN=/tmp/baybin go test ./internal/tlsconf/ -v
```

Le test génère sa propre CA, lance Pebble et challtestsrv, obtient un vrai
certificat et vérifie qu'il se résout par SNI. Sans Pebble sur le `PATH`, il
est **ignoré** — `go test ./...` reste vert sur un checkout nu.

⚠️ Ne jamais ajouter la CA de Pebble au trust store système : sa clé privée est
publique.

Pour Let's Encrypt, **toujours staging d'abord** (`--acme-ca https://acme-staging-v02.api.letsencrypt.org/directory`).
Les quotas de production sont partagés et se consomment vite — et si le domaine
est en `sslip.io`, le quota est **mutualisé entre tous ses utilisateurs**.

## Ce qui n'y est pas, et pourquoi

- **systemd** — inexistant sur macOS. Le PoC supervise des process enfants ;
  l'interface `runner.Runner` est là pour que systemd se glisse derrière
  (cgroups, `MemoryMax`, journald, `Restart=always` deviennent gratuits).
- **Gestion des runtimes** — le PoC emprunte le `node` du `PATH`. Le vrai Bay
  embarque le sien et gère `bay runtime update`.
- Rollback, backups, scale-to-zero : phases suivantes.

### TODO — les metrics applicatives (req/s, latence, event loop)

Une commande `bay top` a existé, lisant le `/metrics` Prometheus que
`alepha/server/metrics` expose. **Retirée**, pour une raison qu'on n'a vue qu'en
la lançant sur une vraie machine : ce module est **opt-in**, et aucune des apps
déployées ne l'importe. La feature marchait sur zéro app sur deux, et il a fallu
déployer un exemple exprès pour la voir fonctionner.

Deux constats qui décideront de la reprise :

1. **Bay est déjà au bon endroit pour compter.** Le proxy voit chaque requête
   avec son code de statut (`proxy.go`, là où `lastSeen.touch` est appelé) et le
   cgroup donne mémoire, CPU et redémarrages. Req/s, err/s et la latence *vue du
   client* ne demandent donc rien à l'app — et marcheraient pour toutes, y
   compris non-Alepha.
2. **Ce que seule l'app peut dire** : le lag de l'event loop (le meilleur signal
   précoce d'une app Node qui va tomber, invisible du dehors), la distinction
   heap / RSS, et les métriques métier.

Quand on y reviendra, ce ne sera pas en reparsant du texte Prometheus : ce sera
un `@alepha/telemetry` basé sur OpenTelemetry.

## Essayer

```bash
go build -o bay ./cmd/bay

# fabriquer l'artefact — aucun manifest à écrire, `alepha build` le dérive
cd ../example-api
yarn alepha build          # émet dist/ + dist/manifest.json
yarn alepha pack -o /tmp   # émet /tmp/example-api-latest.tar.gz
cd -

./bay serve --root /tmp/bay-root --base-domain bay.localhost &
# Aucun token : le control API écoute sur /tmp/bay-root/control.sock, et
# `bay deploy` le trouve tout seul. Il faut donc être sur la machine Bay, root
# ou membre du groupe `bay-control`.
./bay deploy /tmp/example-api-latest.tar.gz --name example-api \
  --control-socket /tmp/bay-root/control.sock

curl -H "Host: example-api.bay.localhost" http://127.0.0.1:8080/
```

⚠️ **`--target=bare` (le défaut), pas `cloudflare`.** Un bundle workerd est
résolu contre les conditions d'export de Cloudflare et n'a pas de point d'entrée
exécutable par node. Bay le refuse au déploiement en nommant le correctif —
sinon l'app se déploie, ne boote pas, et le seul message est
« never became ready ».

## L'artefact

Bay consomme **le format que le framework produit déjà**, pas un format à lui :

```
example-api-latest.tar.gz
├── dist/
│   ├── manifest.json     ← dérivé par `alepha build`
│   ├── index.js
│   └── server/
└── migrations/
```

`dist/manifest.json` est le contrat entre le build et tous ses consommateurs —
`alepha platform up --prebuilt`, Alepha Rocket, et Bay. Déclarer `$repository`
est ce qui met `hasDatabase: true` dedans, et c'est ce `true` qui fait provisionner
la base **et** accorder le droit d'écriture dans le bac à sable. Personne n'écrit
la même chose deux fois, donc la dérive code ↔ infra est impossible par
construction.

Un tar dézippé en root mérite ses gardes : chemins absolus et `..` refusés,
symlinks / hardlinks / devices refusés (l'évasion tar classique est de poser un
lien vers `/etc` puis d'écrire « à travers » à l'entrée suivante), mode d'archive
ignoré (un bit setuid dans un tarball uploadé serait une primitive d'élévation de
privilèges), et une taille d'entrée plafonnée (un disque plein fait tomber toutes
les apps, pas seulement celle qu'on déploie).

## Mesuré sur ce PoC

- binaire `bay` : **9,5 Mo** (sans CertMagic)
- `app.zip` de Lore : **7,79 Mo** (zip ; 6,34 Mo en zstd)
- déploiement complet, app prête à répondre : **0,4 s**
- SSR à travers le proxy : **43 ms**
- asset CSS : **204 Ko** brut → **26 Ko** en brotli (−87 %)

## Ce que le PoC a corrigé dans le design

1. **Le build émet `dist/public/`**, pas un `public/` à la racine de l'archive.
   Hoister voudrait dire déplacer des centaines de fichiers au packaging pour
   rien.
2. **Les assets sont servis à plat depuis la racine web** (`/entry.DyJ8G-7l.js`),
   donc une règle de cache basée sur un préfixe `/assets/` **ne se déclenche
   jamais**. La détection se fait sur le motif de nom hashé `name.HASH8.ext`.
3. **Le build produit déjà les `.br`/`.gz`** — les servir est quasi gratuit et
   divise le transfert par huit.
4. **Les ports de challenge ACME doivent être configurables et cohérents avec
   ce qu'on annonce à la CA.** Laissés par défaut, CertMagic sert le challenge
   sur 80/443 pendant que la CA le cherche ailleurs, et l'échec ne dit pas
   pourquoi (`connection refused`). D'où `--acme-http-port` / `--acme-tls-port`.

## Structure

```
cmd/bay/          CLI + serveur + API de contrôle
internal/
  manifest/       lecture et validation du manifest.json
  state/          état JSON, écriture atomique
  deploy/         dézippage, provisioning, bascule de release
  runner/         cycle de vie des process (systemd derrière cette interface)
  proxy/          routage par host, statiques, reverse proxy
```

## Invariants sous test

`go test ./...`

- un `runtimeVersion` épinglé à l'exact est **refusé** — il recréerait le
  problème que Bay résout (patcher un CVE sans redéployer chaque app)
- une app déclarant des crons n'est **jamais** éligible au scale-to-zero
- l'état survit à un redémarrage, s'écrit en `0600`, laisse un `.bak` et aucun
  fichier temporaire
- le token est généré une fois et persiste
