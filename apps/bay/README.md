# Bay — PoC

Serveur d'applications self-hosted pour apps Alepha. Design complet dans le
folio **Bay** de la campagne Lore « Alepha ».

Ce PoC prouve la tranche verticale : **un `app.zip` entre, une URL HTTPS sort.**

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
- Rollback, backups, scale-to-zero, bay-ui : phases suivantes.

## Essayer

```bash
go build -o bay ./cmd/bay

# fabriquer l'artefact — aucun manifest à écrire, `alepha build` le dérive
cd ../example-api
yarn alepha build          # émet dist/ + dist/manifest.json
yarn alepha pack -o /tmp   # émet /tmp/example-api-latest.tar.gz
cd -

./bay serve --root /tmp/bay-root --base-domain bay.localhost &
export BAY_CONTROL=127.0.0.1:7717
export BAY_TOKEN=$(./bay token --root /tmp/bay-root)
./bay deploy /tmp/example-api-latest.tar.gz --name example-api

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
