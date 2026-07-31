# Pulse — à construire

Cette app n'existe pas encore. Ce fichier est le brief complet pour l'agent qui
la construira. Rien d'autre dans ce dossier.

---

## 1. Ce qu'est Pulse

**L'analytics, les erreurs et les perfs — pour n'importe quelle app, hébergée
n'importe où.** Équivalents : Umami (analytics) + Sentry (erreurs) + Uptime Kuma
(disponibilité), en une seule app, dans le style Alepha.

Pulse est **agnostique de l'hébergement**. Une app sur Cloudflare Workers, sur
Vercel, sur un VPS ou sur Bay envoie ses données de la même façon : un POST
authentifié par une clé d'app. Pulse ne sait pas — et ne doit pas savoir —
comment l'app est déployée.

### Ce que Pulse n'est PAS

C'est la partie la plus importante de ce brief, parce que le découpage a déjà
été fait dans le mauvais sens une fois.

| Pulse | Pas Pulse |
|---|---|
| Erreurs, pageviews, web-vitals, uptime | Déployer, redémarrer, rollback → **bay-admin** |
| Métriques applicatives (heap, latence des routes) | Métriques d'infra (cgroup, restarts systemd) → **bay-admin** |
| Détecter qu'une app va mal | Décider quoi en faire, assigner, suivre → **Lore** |

Les quatre apps et leur frontière :

- **`apps/bay`** (Go) — l'orchestrateur. Un binaire, un socket unix, zéro HTTP
  de contrôle.
- **`apps/bay-admin`** — l'UI et l'API REST de Bay. Équivalent : le dashboard
  Cloudflare. C'est lui qui parle au socket de Bay et qui expose HTTPS pour
  `alepha platform`.
- **`apps/pulse`** — *cette app*. Analytics/erreurs/perfs, agnostique.
- **`apps/lore`** — la gestion de projet. Équivalent : Linear. Reçoit des
  *blights* (incidents) depuis Pulse.

Si tu te retrouves à écrire du code qui déploie quelque chose, tu es dans la
mauvaise app.

---

## 2. Ce qui existe déjà et qu'il faut réutiliser

### `@alepha/pulse-client` → à renommer `@alepha/pulse-client`

`packages/@alepha/pulse-client/` est le SDK côté app. **Il est fini, testé, et
tourne en production sur le VPS.** Ne le réécris pas.

Ce qu'il fait :

- `src/browser/` — pageviews, web-vitals (LCP/CLS/INP), erreurs navigateur,
  envoyés à `POST /api/pulse/ingest` de l'app elle-même.
- `src/server/PulseProxyController.ts` — l'app relaie vers Pulse. Le
  navigateur ne connaît jamais la clé d'app. Le hash visiteur est salé avec
  `request.headers.host` + un sel qui tourne chaque jour → pas de cookie, pas de
  bandeau de consentement.
- `src/server/PulseSinkProvider.ts` — agrège les erreurs par empreinte,
  bufferise, flush toutes les 10 s ou au plafond (`CAPS`). Pas de timer : le
  flush est décidé au moment de `ingest()`.
- `src/server/PulseMetricsProvider.ts` — échantillonne `rss`, `heapUsed`,
  `eventLoopDelayP95`, `reqCount`, `reqDurationP95`.
- `src/shared/pulseFingerprint.ts` — normalise les stacks (hashes de bundle,
  `:ligne:colonne`) pour que la même erreur d'un déploiement à l'autre reste un
  seul groupe.

**Tâche 1 : `git mv packages/@alepha/pulse-client packages/@alepha/pulse-client`**,
renommer le module `alepha.pulse` → `alepha.pulse`, les préfixes
`Pulse*` → `Pulse*`, et la variable d'env. Le nom actuel est trompeur : ce
n'est pas de la télémétrie générique, c'est le client d'un serveur précis.

⚠️ Piège vécu : `PulseMetricsProvider` a été écrit, exporté, typechecké — et
**absent du tableau `services` du `$module`**. Rien ne l'a détecté pendant des
heures. Après le rename, vérifie que chaque provider est bien dans `services`, et
écris un test qui appelle réellement le sampler plutôt qu'un test qui « vérifie
l'enregistrement » (trois de ces tests-là passaient avec l'enregistrement
supprimé).

### Le serveur est déjà là

Le code serveur a été déplacé de `apps/bay-admin` vers ici (2026-08-01) :
entités, ingest, clés d'app, forwarder Lore, outils MCP. Il boote et ses tests
passent. **bay-admin ne contient plus une ligne de Pulse**, et Pulse ne connaît
plus Bay — le couplage inverse (`BayAppSyncService`, le croisement de statut
avec le superviseur) a été supprimé, pas déplacé : Pulse doit marcher pour une
app sur Cloudflare ou Vercel, où il n'y a aucun superviseur à interroger.

Ce qui manque, dans l'ordre :

1. **L'interface.** `src/web/` n'a qu'une page d'attente. La page de détail
   d'app (4 onglets + sparkline) qui servait de base est dans l'historique git,
   à `apps/bay-admin/src/web/components/AppDetailPage.tsx` avant le split — un
   `git log --diff-filter=D --follow` la retrouve.
2. **L'amorçage.** `PulseSecurityProvider` déclare le realm mais rien ne crée le
   premier compte. Copie `BootstrapService` de bay-admin : mot de passe généré,
   imprimé une fois.
3. **L'enrôlement.** `PulseAppController` sait créer et révoquer des clés ; il
   n'y a pas d'UI pour s'en servir.

Ancien contenu de cette section (la liste des fichiers à déplacer) : fait.

À **déplacer vers `apps/pulse`** :

```
src/api/entities/pulseApps.ts        les apps enrôlées + leur clé hashée
src/api/entities/errorGroups.ts      groupes d'erreurs par empreinte
src/api/entities/viewsHourly.ts      pageviews agrégées à l'heure
src/api/entities/uniquesDaily.ts     visiteurs uniques par jour
src/api/entities/vitalsHourly.ts     web-vitals bucketisés
src/api/entities/metricsPoints.ts    séries de métriques applicatives
src/api/entities/heartbeats.ts       dernier signe de vie par app
src/api/entities/loreOutbox.ts       file d'attente vers Lore
src/api/services/IngestService.ts    upserts atomiques (agrégation à l'écriture)
src/api/services/AppKeyService.ts    clés `tk_`, stockées hashées
src/api/services/LoreForwardService.ts
src/api/controllers/IngestController.ts     realm séparé, pas de $secure
src/api/controllers/PulseAppController.ts   enroll/revoke/rotate/appetite
src/api/controllers/AppDetailController.ts  overview/errors/analytics/metrics
src/api/jobs/ForwardJobs.ts
src/mcp/tools/PulseTools.ts
src/web/components/AppDetailPage.tsx
```

À **laisser dans `apps/bay-admin`** (c'est du Bay, pas du Pulse) :

```
src/api/services/BayControlService.ts    parle au socket de Bay
src/api/services/BayAppSyncService.ts    enrôle automatiquement les apps de Bay
src/api/controllers/BayAppController.ts
src/api/controllers/DeviceController.ts  OAuth device grant du terminal
src/api/providers/BaySecurityProvider.ts
src/web/components/DeployCard.tsx, AppsPage.tsx, AppList.tsx, DevicePage.tsx
```

Le stockage est **agrégé à l'écriture** : borné par la cardinalité (nombre
d'apps × nombre de groupes d'erreurs × nombre d'heures), pas par le trafic. Un
million de pageviews et mille pageviews occupent la même place. Garde ce
principe, c'est ce qui rend Pulse hébergeable sur un petit VPS.

---

## 3. Ce qu'il reste vraiment à faire

Dans l'ordre.

### 3.1 Le squelette

Une app Alepha standard : `package.json` (`"name": "pulse"`), `src/main.ts`,
`src/api/index.ts`, `src/web/`, `migrations/`. Copie la forme de
`apps/bay-admin/` — elle est correcte.

### 3.2 Déplacer le code listé au § 2

Avec `git mv`, pour garder l'historique. Puis `yarn v` doit être vert.

⚠️ Les migrations : les entités ne s'enregistrent que par un `$repository`
**réellement injecté quelque part**. Une entité importée mais non injectée
n'apparaît pas dans la migration générée — le bug a déjà coûté une table
manquante (`lore_outbox`, 7 tables sur 8 générées). Vérifie le compte.

### 3.3 L'intégration Lore — **jamais exécutée pour de vrai**

Côté Lore, tout est prêt et mergé :

- `apps/lore/src/api/entities/campaignSources.ts` — sources enrôlées
- `apps/lore/src/api/entities/blights.ts` — les incidents
- `apps/lore/src/api/controllers/SourceIngestController.ts` — action
  `ingestBlights`, authentifiée par clé de source
- `apps/lore/src/api/controllers/CampaignSourceController.ts` — list/create/revoke

Côté Pulse, `LoreForwardService` + `ForwardJobs` existent et **n'ont jamais tourné
en conditions réelles**. C'est la première chose à tester de bout en bout : une
erreur qui franchit le seuil dans Pulse doit apparaître comme un blight dans une
campagne Lore. Teste-le contre le vrai Lore (`lore.alepha.dev`, Cloudflare), pas
seulement en local.

⚠️ Nom d'action : les noms de `$action` sont **globaux à l'app**. Un
`Duplicate action name "ingest"` ne se voit qu'au boot complet du serveur, pas
au typecheck ni dans 5000 tests unitaires. C'est pour ça que l'action Lore
s'appelle `ingestBlights`.

### 3.4 L'uptime — la partie qui n'existe pas

Aujourd'hui il y a `heartbeats` (l'app dit « je suis là »), donc de la
disponibilité **passive**. Il manque le contrôle **actif** : Pulse va chercher
une URL et note le résultat. C'est ce qui distingue « l'app ne rapporte plus »
de « l'app est morte » — et c'est le seul des deux qui marche quand l'app est
tellement cassée qu'elle ne peut plus rien envoyer.

À faire : une entité `checks` (URL, intervalle, attendu), un `$job` qui les
exécute, une entité `checkResults` agrégée à l'heure, et l'escalade vers Lore
après N échecs consécutifs — **pas un ratio**. Un timeout pendant un GC est du
bruit, trois d'affilée sont un motif. La même logique existe déjà en Go dans
`apps/bay/internal/health/watch.go` si tu veux le raisonnement complet.

### 3.5 Lore perd son analytics

Lore garde la moitié éditoriale (décider quels échecs deviennent du travail) et
perd la collecte. Les tables `sigil_views`, `sigil_unique_visitors`,
`sigil_vitals`, `sigil_blight_rate` sont **vestigiales** : elles ne servent plus
à rien mais existent toujours, maintenues en vie par
`apps/lore/src/api/services/VestigialEntities.ts`.

☠️ **Ne supprime pas ce fichier.** Lore tourne sur Cloudflare D1, qui ignore
`PRAGMA foreign_keys=OFF`. Une migration auto-générée qui fait `DROP TABLE` sur
un parent CASCADE **efface silencieusement toutes les lignes enfants en prod**.
`VestigialEntities` existe uniquement pour que drizzle-kit ne génère pas ces
DROP. Quand tu voudras vraiment supprimer ces tables, écris la migration à la
main et relis-la ligne par ligne. Lis `apps/lore/CLAUDE.md` § « Migration safety
on D1 » avant de toucher à `apps/lore/migrations/sqlite/`.

---

## 4. Contexte qui fait gagner des heures

- **La spec** : `docs/superpowers/specs/2026-07-30-pulse-pulse-lore-design.md`.
  Elle est ouverte aux modifications — tu auras plus de contexte qu'elle.
- **Le folio Lore #11** (campagne Alepha, id `1`) : décisions de conception.
  Passe par `campaign_context` puis `folio_get`.
- **Pas d'OpenPulse.** Évalué, écarté par Nicolas. Ne relance pas le sujet.
- **Pas de cookie.** Le hash visiteur salé par jour + par host est délibéré :
  c'est ce qui évite le bandeau de consentement ePrivacy.
- Conventions du repo dans `CLAUDE.md` : jamais `private` (utilise `protected`),
  jamais `vi.mock()`/`vi.spyOn()` (substitution DI + providers Memory), jamais
  `Date.now()` (injecte `DateTimeProvider`), jamais `window.confirm/alert/prompt`
  (utilise `useDialog()`), jamais de JSDoc sur une seule ligne.
- `z.date()` **rejette un timestamp ISO** — il valide une date calendaire.
  Toutes les colonnes de timestamp sont des `z.string()`.
- Alepha patche le `fetch` du navigateur pour y attacher le bearer de session,
  ce qui **remplace silencieusement une clé de source** dans un test Playwright.
  Utilise la fixture `request` isolée, pas `page.request`.
