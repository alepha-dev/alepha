## [0.15.3] - 2026-01-31

### Features

- **react/router**: rename useRouter() .go to .push [BREAKING] (`f385060c`)
- **cli**: show flag enum values in printHelp (`a8d557eb`)
- **security**: actions are not secured by default anymore. secure: true is now required. [BREAKING] (`0973bdfd`)

### Bug Fixes

- **core**: fix unhandled error when running .start() twice (`65661fa6`)

## [0.15.2] - 2026-01-29

### Features

- **react/router**: add page.onEnter (browser only event) (`1fae5992`)
- **cli**: throw error if --arg doesn't exist (`034340a3`)
- **ui**: greatly improve sidebar component (`e551b3a6`)
- **react/router**: merge @alepha/react into alepha main package [BREAKING] (`020b309e`)
- **cli**: init now runs "git init" (`91a0357f`)
- **server**: add more server request context helper (`7a09387c`)
- **cache**: add incr (`15cd4fe0`)
- **redis**: add incr (`fe6d2f0c`)
- **api/keys**: new module for managing API_KEYs (`dbece8bc`)
- **cache**: add testing utils function for memory cache impl (`afdb4454`)
- **security**: allow more than one user-resolver - load user from jwt or apikey or whatever (`10932117`)
- **orm**: repository update accept custom sql``, like Drizzle (`2cc66b23`)
- **cli**: alepha init --pm=bun|node|... and --agent (auto detect claude|codex|...) (`aef9288d`)

### Bug Fixes

- **cli**: allow init in package directory (`a7b1776f`)
- **server/rate-limit**: fix edge cases (`3ac0ab25`)

## [0.15.1] - 2026-01-23

### Features

- **cli**: make index.html optional (`c5476432`)
- **mcp**: add mcp auth provider (`e3b58b19`)
- **orm**: allow to extend Repository.of(entity) (`27210847`)

### Bug Fixes

- **react/router**: fix hydration layer cache (missing part) (`2d5bb481`)

## [0.15.0] - 2026-01-18

### Features

- **cli**: allow "alepha build --bun" for building only with alepha bun-only deps (`bb75c247`)
- **server**: greatly improve http server performance (`232b7a95`)
- **orm**: add db provider "driver" - for specify sqlite driver (default, d1, ...) or postgres (`6dd0fd06`)
- **security**: move all server/security code into security [BREAKING] (`f0eaefd8`)
- **security**: rename $realm -> $issuer and $userReal -> $realm [BREAKING] (`b9230720`)

### Bug Fixes

- **react/router**: fix redirect in SSR streaming mode (`c8657629`)

## [0.14.4] - 2026-01-13

### Features

- **react/router**: rename page 'resolve' to 'loader' as it's more friendly term [BREAKING] (`5fbfb81c`)
- **server/cache**: add stream support (`e6b13604`)
- **vite**: configure alepha build via alepha.config.ts instead of vite.config.ts (`f34590d5`)
- **cli**: add 'alepha gen env' - dump env variables of current app (`a86dd07f`)

## [0.14.3] - 2026-01-08

### Features

- **cli**: add openapi extractor (`5e87f93e`)
- **server/links**: expose link schemas in browser by default (`bd531100`)

### Bug Fixes

- **vite**: use correctly vite server port (`084ee1b6`)
- **server/compress**: fix crash with compress+bun (`24f1ae4f`)
- **ui**: <Sidebar> filter pages based on permissions before populating menu (`eae4bb11`)

## [0.14.2] - 2026-01-05

### Features

- **orm**: alias 'pg' to 'db' and deprecate 'pg' (`9360f3f6`)
- **react/head**: add head.script (`b32b7899`)
- **react**: move all router code in "@alepha/react/router", now "@alepha/react" can be used in Next.js or Expo [BREAKING] (`606260f6`)
- **ui/demo**: add AlephaUIDemo as Alepha UI demonstrator (`6eeaae7a`)
- **ui/json**: add JsonViewer component as standalone module (`10f9fa71`)

## [0.14.1] - 2026-01-01

### Features

- **redis**: add native Bun client support (`e566caeb`)
- **orm**: add native Bun pg/sqlite support (`c5889f17`)
- **orm**: remove all jsonb query features (`2a97d911`)
- **command**: add sub-command support, command env parsing and mode (production, preview, ...) (`565f9093`)
- **cli**: add deploy command (vercel, cloudflare, surge) (`d537cf46`)
- **react/head**: add SEO options (generate og, twitter meta) (`761d5ab9`)

## [0.14.0] - 2025-12-29

### Features

- **cli**: implement changelog generation command (`94559bd1`)
- **vite**: update logger implementation and enhance server start process (`c759db50`)
- **mcp**: integrate MCP API key management and context handling (`951d4fe3`)
- **mcp**: add MCP transport and error handling primitives (`e649f563`)
- **bucket/s3**: add new bucket provider 's3' (`09678594`)
- **command**: equal in '--hello=world' is now optional (`296c9c8e`)
- **vite**: add support of Cloudflare D1 driver + build (`1dbfb6d9`)

### Bug Fixes

- **vite**: precompress files during vite build (`e9712924`)

## [0.13.8] - 2025-12-19

### Features

- **cli**: alepha init now install vite & biome by default (`699d218a`)

## [0.13.7] - 2025-12-15

### Features

- **ui**: add nested object support to TypeForm (`c4e2aaea`)
- **react/form**: support for nested object/array (`54c069f4`)
- **react/core**: add $page props, allow to override props (`f8783eaf`)
- **orm**: add createMany batchSize to avoid hitting database limits (`22a70bc9`)
- **core**: add alepha.core module (`55ccaf61`)
- **core**: add jsonschema to typebox schema converter (`38f4aa19`)
- **api/users**: allow multi user-realm login page (`0a5caebb`)
- **api/users**: allow to add branding stuff to user-realm for ui customization (`b6a6a5c7`)
- **api/parameters**: create api/parameters, a versioned configuration manager (`6601145f`)
- **api/audits**: create api/audits, a new way to log important events inside the app (`78c8d0ab`)
- **cli**: add pre/post hooks (`76ce04c4`)
- **ui**: add theme cookie ttl (`83408abd`)

### Bug Fixes

- **ui/admin**: add admin pages for all api modules (`f9f43fc0`)
- **react/i18n**: fix date format when input is number (`ff8fab47`)
- **orm**: fix t.array of pg.enum (`ff2120de`)
- **core**: register atom set default value on parent store during request (`9305c07e`)
- **vite**: fix error stacktrace on logger output (`d94bb9ea`)
- **orm**: fix missing sqlite bigint mapping (`b4037f6f`)
- **react**: fix ssr template (`7b7d122a`)
- **cli**: fix pnpm bin path (`1dde1534`)

## [0.13.5] - 2025-12-07

### Bug Fixes

- **cli**: fix exec on Windows (`f9495145`)

## [0.13.4] - 2025-12-06

### Bug Fixes

- **ui**: fix export file (`7d1ef88c`)

## [0.13.3] - 2025-12-04

### Features

- **react/head**: allow to add links (`1d830875`)
- **cli**: add command extension via alepha.config.ts (`a926dd43`)
- **command**: add ask.permission (`24ee0e6a`)
- **ui/auth**: add verify email ui (`3a818901`)
- **ui**: add more administration pages (`33ad2a20`)
- **ui**: add theme button (`ea9639fd`)
- **api**: add browser exports (`4617237b`)

### Bug Fixes

- **api/users**: set emailVerified: true when creating a user from oauth2 provider (`7740d68b`)

## [0.13.2] - 2025-12-01

### Bug Fixes

- **server-swagger**: fix ui path (`ca0577e0`)
- **cli**: fix missing env on db:* commands (`5e57bff3`)

## [0.13.1] - 2025-11-30

### Bug Fixes

- **cli**: fix build (`f6ebb040`)
- **cli**: minor fixes (`5d13299b`)

## [0.13.0] - 2025-11-29

### Features

- **server**: add node http server "keepAlive" to true by default (`044fa014`)
- **server-multipart**: add more security (check length) (`09f33d81`)
- **server-rate-limit**: add global $rateLimit (`db668e44`)
- **server-cors**: add global $cors (`3b44cb8e`)
- **core**: add text.lowercase (`3d34493b`)
- **websockets**: add example app (`6b10f757`)
- **api-users**: add login view (`9683a31a`)
- **server-auth**: add login component (`d6d05805`)
- **vite**: add cloudflare workers support (`94de6179`)
- **server**: add node & web request handler, use web request body parser (`c142617c`)
- **benchmark**: add bench again (`63773bf7`)
- **security**: add InvalidCredentialsError (`1882363f`)

### Bug Fixes

- **command**: fix pretty display (`757e6604`)
- **vite**: fix pre-rendering (`81a7bafd`)
- **cli**: fix alepha build (`9861a65a`)
- **api-users**: fix user context (`4ce6e2b8`)
- **api-users**: fix reset password (`612a1e40`)
- **api-users**: fix register (`9c06f6bd`)
- **fake**: fix faker export (`a868127f`)
- **ui**: fix vite.config imports (`74119b23`)

## [0.11.12] - 2025-11-17

### Bug Fixes

- **react**: fix deps (`12f38f70`)
- **devtools**: fix build on ci (`de53eccc`)
- **security**: fix some bugs (`3ffc033d`)

## [0.11.11] - 2025-11-15

### Features

- **alepha**: add keywords (`69ee0954`)
- **alepha**: add npm description (`3f6b8373`)

### Bug Fixes

- **alepha**: add init --orm, fix alepha dev with server only (`a0d83602`)
- **postgres**: rename module to orm alepha: fix init command file: add more methods (`3e7e3652`)

## [0.11.9] - 2025-11-14

### Bug Fixes

- **alepha**: fix main paths (`2fef20ef`)
- **alepha**: fix release (`9960ed7f`)
- **cli**: fix bah subpath (`199f2f6e`)

## [0.11.7] - 2025-11-14

### Features

- **server**: add test for action response filter (`37c8e2f8`)
- **api-jobs**: add provider (`64b24101`)
- **retry**: add retry for flaky test (`2c1d1023`)
- **react-form**: add submitting state (`e6334da5`)
- **ui**: add POC of JsonViewer (`893e6d90`)

### Bug Fixes

- **react**: fix useStore refresh (`39d299cb`)

## [0.11.6] - 2025-11-10

### Features

- **ui**: add DataTable infinite scroll (`a68c119d`)
- **postgres**: add converter string -> querywhere (`150a5744`)
- **cli**: add more drizzle-kit commands (`ca278739`)
- **core**: add $atom, remove .configure() (`4bf9442c`)
- **email**: add $email (`35fb739d`)
- **postgres**: add crud hooks (`f1559d61`)
- **core**: add codec.validate (`51fe9656`)

### Bug Fixes

- **batch**: fix uncaught error (`d447a47b`)
- **core**: prefix all states by "alepha." (`0e73a640`)
- **vite**: fix stacktrace error (`951d8d21`)
- **postgres**: fix missing dep (`b301dc81`)

## [0.11.5] - 2025-11-05

### Features

- **vite**: add stats plugin (`f8ea7708`)
- **file**: add FileSystem & NodeFileSystem (`7d8e7c51`)
- **ui**: add collapsed sidebar (`6e11e39d`)
- **devtools**: add logviewer (`24ed1484`)
- **devtools**: add ui (`1eddb861`)
- **ui**: refactor Sidebar, add ActionButton, OmnibarButton, LanguageButton (`5050b655`)
- **react**: add useAction() for handling user action on ui (`2ba970fe`)
- **fake**: add new module for faking data based on typebox (`8520c50c`)
- **react**: add browser test (`54f4aa76`)

### Bug Fixes

- **ui**: fix action href when http://, fix theme (`22b26dd1`)
- **server**: fix vite dev server reload when file got ?t=timestamp (`34e2eb51`)
- **react**: fix useAction refresh, replace useRouterEvents by useEvents, add new method router.concretePages (`cda992ff`)
- **cli**: fix bad version (`a7a56ff3`)

## [0.11.3] - 2025-10-31

### Features

- **react-i18n**: add <Localize/> (`4dd0ff7d`)

### Bug Fixes

- **server-links**: fix browser links (`555512c2`)
- **postgres**: fix sqlite count (`a8632856`)

## [0.11.2] - 2025-10-30

### Features

- **starter**: add tests (`2bfde2c5`)
- **starter**: add starter inside monorepo too (`b5f5789b`)
- **integration**: add react ssr test (`b2811e4d`)

### Bug Fixes

- **postgres**: fix dev synchro of sqlite (`45893603`)
- **server-links**: fix local link (`5526e49f`)

## [0.11.1] - 2025-10-29

### Bug Fixes

- **server-cookies**: fix useless load of security (`e196fb79`)
- **ui**: fix build (`f1133bde`)

## [0.11.0] - 2025-10-29

### Features

- **cli**: add commands for each tool used by alepha (`a63fe444`)
- **ui**: add DataTable, Sidebar, more Action options (`5a1818c5`)
- **postgres**: add missing test file (`1f7fc23e`)
- **core**: allow func instead of class logger: improve colors cli: add alepha dev (`6a5aaf16`)

### Bug Fixes

- **core**: fix trim server: http client fetch now use schema for response typing logger: shorter uuid on dev (`49f0e6f7`)
- **scheduler**: fix bad log (`2106326f`)

## [0.10.7] - 2025-10-23

### Features

- **alepha**: add ui, verifications & notifications (`289ff463`)
- **postgres**: relations - add more tests (`ed2dfc95`)
- **ui**: add ControlDate (`37f452aa`)
- **ui**: add TypeForm first version ui: add DarkModeButton (`dd4dba74`)
- **ui**: add default router (`5a17fc93`)
- **protobuf**: add enum support (`04338008`)
- **api-users**: add all CRUD controllers server: add beginning of 'web' server support server-cache: improve cache api (`cbc4f8b0`)
- **playground**: add jp ui (`c0efbca2`)
- **api-users**: add verify email service (`9a92ab6c`)
- **api-notifications**: add sms provider (`8b7b890b`)
- **core**: add text trim api-validations: create module (`30796249`)
- **email**: add support of () => body (`d7a579b3`)
- **email**: add support of template {{ value }} (`a7cbcf48`)
- **api-users**: add users forget password (`fbb861dd`)
- **api-users**: add users forget password (`6b33f4ed`)
- **postgres**: add pg jsonb queries (`086fba23`)
- **postgres**: another try to add relations (`b1c3acfe`)
- **postgres**: add 'where' -> findOne (`f5dc6e8f`)

### Bug Fixes

- **api-files**: add metadata update postgres: minor fixes react-i18n: add more tests ui: add examples (`69a7792e`)
- **postgres**: relations - fixes (`55f170d2`)
- **postgres**: fix distinct (`f16aedc4`)
- **core**: add alepha.isViteDev core: fix events.emit typing api-notifications: create module (`2aade9c4`)

## [0.10.6] - 2025-10-16

### Features

- **server-links**: add realm security (`c4a26b29`)
- **server-cache**: add support of etag without caching (`cabf02f8`)

### Bug Fixes

- **cli**: fix bin path (`fad8e0d8`)
- **server-cache**: fix etag-only feature (`f25d25a4`)
- **postgres**: fix bad mapping of t.date() with postgres date string (`3075ba67`)

## [0.10.5] - 2025-10-13

### Features

- **postgres**: add missing export (`db714f67`)

### Bug Fixes

- **vite**: let vite handle request in dev only if writeHead has not been called (`613dcdc1`)

## [0.10.4] - 2025-10-13

### Features

- **postgres**: add pg.one (`0ca23297`)
- **postgres**: add pg.many (`7664d584`)
- **api-users**: add built-in realm & auth configurations (`f36c6f67`)
- **scheduler**: add begin/end events (`946b462f`)
- **api-files**: add more tests (`cc0b1fd3`)
- **api**: add all entities for all api modules (`aae593fd`)
- **devtools**: add /logs (`d538216b`)
- **cache**: add .clear() (`bcaf84d9`)

### Bug Fixes

- **api-users**: fix deps (`d43f9293`)
- **server**: fix queryparams parser (`3688ae75`)

## [0.10.3] - 2025-10-04

### Features

- **devtools**: add POC ui (`1d44df81`)
- **react**: add router.reload() (`adb59853`)

## [0.10.2] - 2025-10-03

### Features

- **devtools**: add module/provider collector (`ce5aef54`)
- **devtools**: add several collectors (`75abd610`)

### Bug Fixes

- **server**: fix run config typings (`ed3965df`)

## [0.10.1] - 2025-09-29

### Features

- **cli**: add pm choice (`342f18d7`)
- **command**: add Ask helper (`3eddfc93`)

### Bug Fixes

- **server-compress**: fix build (`9d8db551`)
- **cli**: fix version replace (`2edcfef6`)

## [0.10.0] - 2025-09-20

### Features

- **swagger**: add array support for request body (`3fefd1ba`)
- **commands**: add cli cmd <args> parser (`4eafb12e`)
- **protobuf**: add support of array and more primitives (`9966648b`)
- **server**: add request-id to http error response (`0d1d875d`)
- **server-cache**: add etag-only on route (`c13374d5`)

### Bug Fixes

- **command**: fix tests (`703028d5`)
- **react-i18n**: fix tr() typing (`0977e8be`)
- **queue**: fix build (`e2ba1c0e`)

## [0.9.5] - 2025-09-14

### Features

- **thread**: add polling (`a715c4ce`)
- **react**: add more tests (`a2251d3c`)
- **react-head**: add useHead() (`5eeae0ef`)
- **server-rate-limit**: add $rateLimit and by $action (`8efa179f`)
- **server-rate-limit**: add more tests (`651ff506`)
- **server-rate-limit**: add proof of concept (`6164b30c`)
- **server-static**: add support of filename with space (`fed43c15`)
- **react**: add page animation enter/exit (`93f940cc`)
- **react**: add page.animation (`0ac77910`)

### Bug Fixes

- **thread**: fix build (`47e22333`)
- **react**: fix nested view bad refresh when 2 layers are refreshed (`a1c4341c`)
- **core**: fix tests (`8f55407b`)
- **core**: fix non-singleton service injection after start (`90b64ae9`)

## [0.9.4] - 2025-08-22

### Features

- **postgres**: add soft delete with pg.deletedAt() (`198a0150`)

### Bug Fixes

- **logger**: fix typings (`06919988`)
- **bucket-azure**: fix name mapping (`c9f0a48a`)
- **server**: fix multipart client (`d402ce3c`)
- **postgres**: fix bad type mapping (`96ae3075`)
- **react**: fix push base path (`34c705cc`)
- **server**: minor fixes (`63dfab06`)

## [0.9.3] - 2025-08-10

### Features

- **react**: add internal auth (`1df00a70`)
- **react**: add static cache page (`12d7f30c`)
- **i18n**: add more docs (`3356d2fd`)

### Bug Fixes

- **react-auth**: fix bad ttl on tokens cookie (`6f065f97`)
- **react-auth**: fix refresh typ (`c2b23b50`)
- **vite**: fix bad path (`400bd66e`)

## [0.9.2] - 2025-07-30

### Features

- **react**: add react form docs (`aebcd8cd`)
- **react**: add new package "react-form" (`7b0031c9`)

## [0.9.1] - 2025-07-29

### Features

- **command**: add run.cp (`17da7efd`)
- **command**: add typebox string augmentation (`31a299e9`)

### Bug Fixes

- **vite**: fix pre-rendering (`2fcc485f`)

## [0.9.0] - 2025-07-26

### Features

- **thread**: add package (`513ca7ed`)
- **bucket**: add more options to events (`cf281df9`)
- **bucket**: add upload/delete events (`87f72c65`)
- **bucket**: add memory & local impl (`bfb320df`)

### Bug Fixes

- **server**: node - fix body response stream from webstream (`5a7453cb`)

## [0.8.1] - 2025-07-16

### Features

- **react**: add support of base url (`cc8d088f`)

## [0.8.0] - 2025-07-13

### Features

- **command**: add new package (`0916f79d`)
- **queue**: add context id (`a0af80af`)
- **server-static**: add tests (`e5343987`)
- **alepha**: add compress & multipart (`68ad485c`)
- **server-cors**: add tests (`26a40ed8`)
- **server-cookies**: add encrypt+sign and tests (`b2006484`)
- **server**: add x-request-id support (`d9a5d02c`)
- **postgres**: add $db (`9e63a1fb`)

### Bug Fixes

- **server-static**: fix deps (`2ce5a02e`)
- **server**: fix browser imports (`1735d416`)

## [0.7.7] - 2025-07-06

### Features

- **postgres**: add a sneaky sqlite mode (`81467fb1`)

### Bug Fixes

- **server-links**: fix typings (`1d0e0821`)

## [0.7.5] - 2025-07-02

### Features

- **postgres**: add distinct & columns (`f75794dd`)

### Bug Fixes

- **postgres**: fix var env order (`75cc2b96`)
- **core**: fix crash on browser (`574d2e69`)
- **cache**: fix tests (`357b4596`)

## [0.7.4] - 2025-06-30

### Bug Fixes

- **scheduler**: still trying fix tests on gh (`85451a0f`)
- **scheduler**: add prefix to tests (`3c147739`)
- **scheduler**: try to fix tests on gh actions (`8f0aa3f7`)

## [0.7.3] - 2025-06-28

### Bug Fixes

- **postgres**: improve built in drizzle kit server: fix etag bad cache key on browser vite: refactor plugins (`fca91f63`)

## [0.7.1] - 2025-06-25

### Features

- **bucket**: add bucket-azure (`1b4fd4e4`)
- **server**: cache - add etag support (`9d3100f1`)
- **react**: add $page.client (like ssr=false) (`2087bebe`)
- **react**: add server cache (`0a0c3a20`)
- **react**: add SSG (`c365e16b`)
- **core**: add file() util (`289a9825`)
- **server**: add get link schema (`9e0e69ca`)
- **server**: add action cache (`7d799a20`)
- **security**: add permission exclude (`35be968c`)
- **server**: client - add getLinks force:boolean (`aecedb92`)
- **server**: add $remote.withSchema (`fceb9989`)
- **server**: add compress for stream, add server timing (`d9a49704`)
- **server**: add compress (`f5ce2066`)
- **server**: add client scope options (`46228e06`)

### Bug Fixes

- **postgres**: fix push with pgschema (`e74484b0`)
- **react-auth**: fix get access token from cookies (`d4634c11`)
- **postgres**: fix sync devmode (`7b757bb5`)
- **postgres**: fix synchro in devmode (`28b3d015`)
- **core**: fix json logger error (`2ae82a0c`)

## [0.7.0] - 2025-05-31

### Features

- **server**: add not-ready, health project: upgrade dependencies (`40ed00f7`)
- **core**: add $retry onError (`3faf3288`)
- **static**: add historyApiFallback (`d5916e26`)
- **postgres**: add pagination count (`6a5c5098`)
- **security**: add jwt service account (`0d6572f8`)

### Bug Fixes

- **react-auth**: fix bad url (`ae96c774`)
- **react**: fix auth (`a1214a00`)
- **react**: fix typings (`e568c40f`)
- **server**: fix tests (`f9b67630`)
- **security**: fix typings (`5f6e3737`)

## [0.6.10] - 2025-05-21

### Features

- **server**: $remote - add more options (`76dc820a`)
- **server**: add missing type + tests (`41f6ad75`)

### Bug Fixes

- **server**: fix invalid content type mapping (`1e0dbbfd`)
- **proxy**: add rewrite url + fix forward headers (`2a5da077`)
- **server**: fix client file response (`a9d3f70f`)
- **queue**: fix browser module (`145fc5fe`)

## [0.6.9] - 2025-05-19

### Features

- **server**: add filepath to FileLike (`e1ae1189`)
- **server**: add http client response file (`5cbf68d0`)

### Bug Fixes

- **server**: fix node import inside browser (`0499f21e`)
- **server**: fix header merge (`92c63e58`)
- **server**: fix local function response parsing (`205c30c8`)
- **server**: minor fixes on multipart (`35e3225c`)
- **server**: fix missing casting fileLike on http request (`6f5ac2eb`)
- **server**: fix arrayBuffer casting (`91b512c5`)

## [0.6.8] - 2025-05-17

### Features

- **vite**: add line to separate each run (`dad5e0f6`)
- **server**: add var env for als, default to true (`ebb2e79b`)
- **react**: add useApi<T> (`4eaad177`)

### Bug Fixes

- **postgres**: add $entity, fix default schema name (`d6fce4e1`)
- **queue**: fix provider start order (`cc164410`)

## [0.6.6] - 2025-05-16

### Bug Fixes

- **alepha**: fix package.json (`e749caa5`)

## [0.6.5] - 2025-05-16

### Bug Fixes

- **swagger**: allow string response, fix ui patch (`39b9904d`)

## [0.6.4] - 2025-05-11

### Features

- **swagger**: add initOauth options (`1f52aca4`)
- **alepha**: add missing exports (`c637d941`)

## [0.6.3] - 2025-05-10

### Features

- **server**: add ip, user-agent to http request logger (`9f8b356b`)
- **static**: add headers supports (`cacf4100`)
- **server**: add t.file() response support (`535cb959`)
- **swagger**: add option to disable ui (`1f1d2cae`)
- **server**: add multipart support (`6331127e`)
- **server-proxy**: add $proxy (`f492ee0e`)

### Bug Fixes

- **react-auth**: fix browser side user (`d2a99dde`)
- **cookies**: fix set-cookie header (`f53b1aa5`)
- **swagger**: fix copy script (`16c68e6d`)
- **playground**: fix ssr (`d995ae77`)

