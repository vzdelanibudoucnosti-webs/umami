# Plán změn — analytika portfolia VZB

**Datum auditu:** 2026-09-09
**Rozsah:** instance Umami `analytics.vzdelanibudoucnosti.cz` + všech 6 webů portfolia
**Branch:** `worktree-audit-multisite` (worktree z `master` @ `ca661c705`, v3.3.1)
**Navazuje na:** `vzb-docs/pridani-webu-do-umami.md` (postup napojení jednoho webu —
tenhle dokument ho nenahrazuje, řeší vrstvu nad ním: *které* weby, *proč* a *jak měřit*)

**Zadání od Pavla (2026-09-09):**
1. Umami je **primární analytika** pro všechny weby.
2. Cíl je **server-side tracking**, protože klient může analytiku zablokovat.
   Požadavek: „chci mít přesný přehled."

Bod 2 je splnitelný, ale ne doslova — sekce 4 vysvětluje proč a co místo toho.

---

## 1. Naměřený stav (2026-09-09, reálné načtení v prohlížeči)

Každý web byl otevřen v Chromiu a odchycen network traffic. Grep do HTML nestačí —
hlavní web vkládá tracker až klientsky, ve zdrojáku není ani slovo „umami".

| Web | Stack | Umami | GA4 | Universal Analytics | Vercel Insights | GTM | vlastní |
|---|---|---|---|---|---|---|---|
| `vzdelanibudoucnosti.cz` | Next.js (Pages) | ✅ `/s/` proxy | ✅ `G-G1Q4FEGBBQ` | – | ✅ | ✅ | ✅ `/api/px` |
| `hry.vzdelanibudoucnosti.cz` | Next.js (App) | ✅ `/s/` proxy | – | – | – | – | – |
| `knihovna.vzdelanibudoucnosti.cz` | ? | ❌ | ❌ | – | – | – | **nic** |
| `code.vzdelanibudoucnosti.cz` | Next.js / Vercel | ❌ | ❌ | – | ✅ | – | – |
| `www.pocitacedetem.cz` | WordPress | ❌ | ✅ **2×** `G-66ZG5QWT77` + `G-RDD0RQ1670` | – | – | ✅ `GTM-TLTMG2P` | Cloudflare Insights |
| `pythongo.cz` | Next.js / Vercel | ❌ | ✅ `G-2T3SDFG8KP` | ⚠️ `UA-133426578-2` | ✅ | – | doubleclick |

**Umami dnes pokrývá 2 z 6 webů.**

**Stav instance (černá skříňka, bez přihlášení):**

- `/api/heartbeat` → `200 {"ok":true}`, root odpověď ~0,48 s
- `/stats.js` i `/script.js` → `200`, 4733 B, `cache-control: public, max-age=86400`
- `/api/websites`, `/api/admin/users` → `401` (správně gated)
- CSP i `strict-transport-security: max-age=63072000` nasazené
- `/api/config`: `cloudMode:false`, `privateMode:false`, `telemetryDisabled:true`,
  `trackerScriptName:"stats.js"`
- Fork je **bit-identický** s `umami-software/umami@master` — 0 vlastních commitů

---

## 2. Zjištění, seřazená podle dopadu

### P0 — data, která dnes nevznikají

**F1 — `knihovna.vzdelanibudoucnosti.cz` nemá žádnou analytiku.**
Ani Umami, ani GA, ani nic jiného. O tomhle webu neexistují data vůbec.

**F2 — `code.vzdelanibudoucnosti.cz` má jen Vercel Insights.**
Tedy pageviews bez segmentace, bez zdrojů návštěvnosti, bez událostí a bez možnosti
srovnat to s ostatními weby. Fakticky „skoro nic".

**F3 — `pocitacedetem.cz` a `pythongo.cz` nejsou v Umami.**
Čtyři z šesti webů portfolia jsou mimo instanci, kterou provozujeme. Srovnání napříč
portfoliem nejde udělat ani ručně — GA4 a Umami počítají session jinak.

**F4 — `pythongo.cz` načítá mrtvý Universal Analytics.**
`gtag/js?id=UA-133426578-2` + `google-analytics.com/analytics.js`. UA je vypnuté od
1. 7. 2023, ta data nikam nejdou. Zůstal jen požadavek na třetí stranu navíc —
nulová hodnota, nenulová GDPR stopa.

### P1 — kvalita a interpretovatelnost dat

**F5 — hlavní web běží na čtyřech paralelních stackech současně.**
Umami + GA4 + Vercel Insights + vlastní `/api/px`. Čtyři různá čísla návštěvnosti,
čtyři různé definice session, čtyři věci k pokrytí v souhlasu.

**F6 — `pocitacedetem.cz` posílá pageview dvakrát do dvou GA4 property.**
`G-66ZG5QWT77` přes WP plugin *MonsterInsights*, `G-RDD0RQ1670` přes `GTM-TLTMG2P`.
K tomu Cloudflare Insights jako třetí měření.

**F7 — `/api/px` na hlavním webu nemá vyloučení interního provozu.**
Píše do `analytics.pageview_event` nezávisle na Umami a `IGNORE_IP` se ho **netýká** —
vaše vlastní návštěvy v něm tedy jsou, na rozdíl od Umami. Dvě čísla, dvě různé
definice „návštěvník".

**F8 — runbook `pridani-webu-do-umami.md` je zastaralý.**
Tvrdí, že `hry.vzdelanibudoucnosti.cz` je „zatím bez Umami" a označuje ho za
*pravděpodobného prvního kandidáta*. Měření tam už běží (ověřeno dnes).

### P2 — provoz instance

**F9 — na forku neběží žádné CI.**
`.github/workflows/ci.yml:12` má `if: github.repository == 'umami-software/umami'`,
takže se na `vzdelanibudoucnosti-webs/umami` celý job přeskočí. Vercel deployuje
`master` bez `pnpm test` a bez build gate.

**F10 — konfigurace nasazení žije jen ve Vercel dashboardu.**
V repu není `vercel.json`. Env proměnné nemají v gitu ani seznam.

**F11 — žádná retence dat.**
Self-hosted v3.3.1 nemá mazání podle stáří. Relational-only nad **sdíleným** Supabase
Postgresem. Server-side tracking objem zápisů podle sekce 4 ještě zvýší.

**F12 — `IGNORE_IP` blokuje vlastní síť, takže si měření nejde ověřit.**
Ověřeno dnes: `/s/api/send` vrací z téhle sítě **403** na obou napojených webech.
Prázdný dashboard po testu pak vypadá jako rozbité měření.

**F13 — server-side tracking dnes vrací 500.** Chybějící geo databáze na Vercelu +
nechycená výjimka. Podrobně v 4.0. **Opraveno v tomhle repu** (`57f733070`), zbývá
nastavit `BUILD_GEO=1`.

**F14 — `IGNORE_IP` jde obejít jednou hlavičkou.** `true-client-ip` je první
v `IP_ADDRESS_HEADERS` (`src/lib/ip.ts:5`) a Vercel ji nenastavuje ani nestriptuje,
takže hodnota od volajícího vyhraje. Změřeno oběma cestami — request, který bez hlavičky
vrací **403**, vrací s `true-client-ip: 8.8.8.8` **200**, a to jak přímo na instanci,
tak **přes veřejnou proxy `/s/` měřeného webu**. Protože je `/api/send` bez autentizace
a `websiteId` je veřejné, může kdokoli zapisovat události pod libovolnou IP, lokalitou
a session. `x-forwarded-for`, `x-vercel-forwarded-for` ani `x-real-ip` podvrhnout nejdou —
Vercel je přepisuje.
**Oprava je konfigurační: `CLIENT_IP_HEADER=x-real-ip`.**
⚠️ **Ne `x-vercel-forwarded-for`** — na deploymentu Umami je to IP měřeného webu, ne
návštěvníka, takže by se všichni slili do jedné session. Plná matice měření
v `vzb-docs/umami-instance-config.md`.

**F15 — middleware tracking už jednou zaveden byl a byl zrušen.**
`lib/analytics/pxClient.ts:3-5` na hlavním webu: dřívější širší middleware způsobil
**16 656 invokací za 24 hodin**, proto se zrušil a serverová vrstva `/api/px` dnes měří
jen allowlist pěti cest trychtýře. Kdokoli navrhne middleware měření, znovu otevírá
rozhodnutí, které tenhle repo už jednou otočil — a má na to vlastní produkční číslo.

### Co je naopak v pořádku (a nemá se na to sahat)

- Instance je zdravá, rychlá, API správně gated (401), CSP i HSTS nasazené.
- Proxy `/s/stats.js` je same-origin → adblocky ji neblokují a projde CSP `'self'`.
- Fork bez divergence = upgrade Umami je `git merge upstream/master`, bez konfliktů.
- Hlavní web má `data-auto-pageview="false"` — což je, jak se ukáže v sekci 5,
  přesně ta konfigurace, kterou hybridní model potřebuje.

---

## 3. Rozhodnutí: Umami je primární

Platí pro všech 6 webů. Důsledky:

- **GA4 zůstává jen tam, kde na něm visí konkrétní potřeba** — Google Ads konverze,
  propojení se Search Console. Ne „pro jistotu".
- **Vercel Insights a Cloudflare Insights se vypínají** všude, kde je Umami.
  Neposkytují nic navíc a Vercel Insights se účtuje.
- **Reportuje se z Umami.** Když se čísla rozejdou, platí Umami.

---

## 4. Server-side tracking — co to reálně řeší a co ne

Tohle je jádro zadání, tak k němu rovnou to nepříjemné:
**„100 % server-side" a „přesný přehled" nejsou totéž.** Server-side maximalizuje
*úplnost* (nikdo vám měření nezablokuje), ale zhoršuje *přesnost* (napočítá věci,
které nejsou návštěvy). Obojí najednou dá až kombinace obou vrstev — sekce 5.

### 4.0 BLOCKER: server-side tracking dnes na naší instanci vrací 500

**Ověřeno na živé instanci 2026-09-09, ne odvozeno.** Nemutující sonda
(`type:"identify"` bez `id` i `data` — nic nezapisuje, ale projde detekcí klienta):

```
A) identify BEZ payload.ip  → HTTP 403   (IGNORE_IP, čekaný stav z naší sítě)
B) identify S  payload.ip   → HTTP 500   {"code":"server-error"}
```

Příčina je řetěz tří věcí, každá sama o sobě neškodná:

1. `scripts/build-geo.js:17` — **na Vercelu se GeoLite2 databáze nestahuje**, pokud není
   nastaveno `BUILD_GEO`: „Vercel environment detected. Skipping geo setup."
2. `src/lib/detect.ts` — když přijde `payload.ip`, zavolá se `getLocation(..., skipHeaders: true)`,
   což **přeskočí Vercel geo hlavičky** a spadne rovnou na databázový lookup.
3. `maxmind.open()` nad neexistujícím souborem **vyhodí výjimku a nikdo ji nechytá** →
   propadne až do `catch` v `route.ts:380` → `serverError`.

Dnešní klientský tracker `payload.ip` neposílá, takže se bod 2 nikdy nespustí a všechno
funguje. **Jakmile se přidá serverová vrstva, přestane fungovat úplně všechno** — a protože
se reader cachuje v `globalThis`, selže první request a všechny další taky.

**To je taky odpověď na „proč to nikdo nemá hotové".** Není to konfigurační detail,
je to chyba v Umami: chybějící volitelná databáze nemá dělat z requestu 500.

Řešení má dvě části a **obě jsou v tomhle repu už hotové** (viz sekce 6, Krok 0):

- **Oprava Umami:** `getLocation` chybějící databázi zaloguje a pokračuje bez geolokace
  místo výjimky, a selhání si zapamatuje, aby se lookup nezkoušel při každém requestu.
- **Konfigurace:** `BUILD_GEO=1` ve Vercel env instance, aby geolokace u serverových
  událostí vůbec vznikla. Bez toho by země/město u server-side událostí zůstaly prázdné.
  GeoLite2-City je 32 MB komprimovaně — přidá se do build artefaktu, což je potřeba ověřit
  proti limitu velikosti funkce.

### 4.1 Co server-side skutečně vyřeší

Ověřeno ve zdrojáku instance, ne odhad:

- **Adblock, uBlock, Brave, DNT, blokované třetí strany.** Beacon už neodchází
  z prohlížeče, není co blokovat.
- **Souhlasový banner, který zdrží nebo zruší načtení skriptu.**
- **Safari ITP a cookie-less prostředí.** Session se počítá na serveru jako
  `uuid(sourceId, ip, userAgent, salt)` (`src/app/api/send/route.ts:158`) — žádná cookie.
- **Bonus, se kterým se nepočítá:** `websiteId` zmizí z HTML. Endpoint `/api/send` je
  `skipAuth: true` (`route.ts:76`) a `payload.ip` i `payload.userAgent` se přebírají
  **bez ověření** (`src/lib/detect.ts:130-131`), takže dnes může kdokoli, kdo si přečte
  zdroják stránky, poslat do vašich dat libovolné události s podvrženou IP.
  Server-side tuhle expozici odstraní.

### 4.2 Co server-side nedokáže — nikdy

| Co | Proč |
|---|---|
| **Core Web Vitals** (LCP, INP, CLS, FCP, TTFB) | `type: 'performance'` (`route.ts:345`) měří prohlížeč. Server je nemá odkud vzít. Hlavní web je dnes sbírá. |
| **Rozlišení obrazovky** | A `getDevice()` (`detect.ts:48-60`) podle šířky odlišuje `desktop` od `laptop`. Bez `screen` bude všechno `desktop`. |
| **Klientské události** | Kliknutí na CTA, odeslání formuláře, `solo_started` — o tom ví jen prohlížeč. |
| **Navigace, které nejdou na server** | bfcache, tlačítko zpět, část SPA přechodů. |

### 4.3 Co server-side aktivně zhorší (a je potřeba s tím počítat)

1. **Prefetch — a filtr na něj v middleware spolehlivě nefunguje.**
   Next.js `<Link>` si v produkci předtahuje RSC payload pro **každý odkaz, který se
   objeví ve viewportu**. To jsou requesty na server pro stránky, které nikdo neviděl.

   Obvyklá rada je odfiltrovat je hlavičkou `next-router-prefetch` / `purpose: prefetch`
   (i přes `matcher.missing` v konfiguraci middleware). **Jenže ta hlavička v middleware
   spolehlivě není** — jsou na to otevřené issues
   [#85836](https://github.com/vercel/next.js/issues/85836) a
   [#63728](https://github.com/vercel/next.js/issues/63728), plus
   [diskuze #37736](https://github.com/vercel/next.js/discussions/37736).

   Next.js sám v dokumentaci k prefetchi říká, že se analytika **nemá** volat při renderu,
   a doporučuje ji přesunout do `useEffect` — tedy na klienta
   ([Guides: Prefetching → Triggering unwanted side-effects](https://nextjs.org/docs/app/guides/prefetching)).

   **Tohle je přímo proti zadání „nezkreslená data".** Nafouknutí není odhad, je to
   dokumentovaný a dosud nevyřešený problém.
2. **Boti.** Klientsky se bot bez JS nikdy nezapočítal. Server-side dorazí každý crawler.
   `isbot(userAgent)` (`route.ts:142`) odchytí ty poctivé; zbytek skončí ve vašich číslech.
3. **Objem zápisů do DB.** Bez `x-umami-cache` tokenu běží `createSession` na každém
   requestu (`route.ts:163`). Je to `on conflict do nothing`, takže korektní, ale je to
   zápis navíc na sdílený Supabase pooler — viz **F11**.
4. **Geolokace se změní.** Když pošlete `payload.ip`, `getLocation` dostane
   `skipHeaders=true` (`detect.ts:132`) a **přeskočí Vercel/Cloudflare geo hlavičky**
   ve prospěch lokální GeoLite2 databáze. Výsledky budou o kus jiné než dnes.

### 4.4 Technické jádro, na kterém celý model stojí

Session je `uuid(sourceId, ip, userAgent, sessionSalt)`. Nic víc.

Z toho plyne to podstatné: **serverová událost a klientská událost od stejného
návštěvníka vyrobí identické `sessionId`** — pokud server přepošle *skutečnou* IP
a User-Agent návštěvníka v `payload.ip` a `payload.userAgent`. Obě vrstvy pak
zapadnou do jedné session bez jakéhokoli párování.

Druhá strana téže mince: **když IP nepřepošlete, spadnou všichni návštěvníci do jedné
session** — do té, která patří vašemu serveru. To je nejčastější způsob, jak si
server-side tracking rozbít, a v datech se to pozná až po týdnu.

---

### 4.5 Jak to řeší ostatní (a vybočujeme?)

Krátká odpověď: **nevybočujeme, hybrid je mainstream.** Ale „server-side" znamená
v praxi něco jiného, než se běžně čeká.

- **Plausible** má Events API pro server-side a jeho kontrakt je **identický s Umami**:
  musíte poslat `X-Forwarded-For` s reálnou IP návštěvníka a správný `User-Agent`,
  jinak se počítání unikátních návštěvníků rozbije. Jejich dokumentace přímo varuje,
  že když proxy pošle vlastní IP místo návštěvníkovy, **bot filtr událost zahodí**.
  Přesně ta past, která je popsaná v 4.4.
- **Server-side GTM (sGTM), Stape, Piwik PRO** — tady je nejčastější omyl v celé
  branži: **sGTM nenahrazuje klientský sběr.** V každém produkčním nasazení pořád běží
  webový kontejner v prohlížeči a posílá data na váš tagovací server. Server-side se
  přesouvá *přeposílání a obohacení*, ne *sběr*. Kdo čeká, že mu sGTM obejde adblock
  na straně sběru, nasadí něco jiného, než si myslí.
- **Segment / RudderStack / PostHog** — kanonický model je přesně ten hybridní:
  server-side pro události, které vznikají na backendu (platba, registrace, objednávka),
  klient pro to, co se děje v UI. Nikdo z nich nedoporučuje měřit pageviews ze serveru.
- **Log-based analytika** (AWStats, GoAccess) je „100 % server-side" ve své nejčistší
  podobě — a je dávno opuštěná právě proto, že napočítá boty, prefetch a cache.

Z toho plyne jedna nepříjemná, ale důležitá věc: **first-party proxy `/s/`, kterou už
máte, je ta hlavní obrana proti adblocku** — a máte ji nasazenou. Skript i beacon jsou
same-origin, na filtračních listech nejsou. Marginální zisk z middleware vrstvy je proti
tomu malý (návštěvníci s vypnutým JS, odchod před hydratací, banner blokující načtení),
zatímco riziko zkreslení podle 4.3 je reálné a dokumentované.

**Proto sekce 6 začíná měřením, ne stavbou.**

### 4.6 Boti a falešné pageviews — co k nám reálně dojde

Veřejná čísla o botech (Cloudflare Radar 06/2026: 57,5 % HTML requestů; Imperva
*Bad Bot Report 2026*: 53,3 % automatizovaného provozu) popisují **edge logy, ne dashboard
Umami**. Protože měříme klientským beaconem, většina botů se k `/api/send` vůbec nedostane
— GPTBot, ClaudeBot, PerplexityBot ani náhledoví boti Slacku a WhatsAppu **nespouštějí JS**.

Z toho plyne obrácené pořadí priorit, než se čeká:

**1. Prerender byl reálný problém — a je opravený.** ✅ `b1bd87c9b`
Prerenderovaná stránka spustí skripty a dojde do `readyState: 'complete'`, takže tracker
odeslal pageview pro stránku, kterou nikdo neotevřel. **Nepotřebuje to souhlas webu** —
Chrome prerenderuje z adresního řádku sám a ověřeno, že žádný z našich webů `speculationrules`
neemituje, takže všechny falešné pageviews pocházely z predikce prohlížeče.
Nešlo to odfiltrovat na serveru: `Sec-Purpose` je na requestu dokumentu, ne na beaconu.
Tracker teď čeká na `prerenderingchange`.

*Next.js `<Link>` prefetch tenhle problém nemá* — stahuje RSC payload a skripty stránky
nespouští. Prerender je jiný mechanismus.

**2. Přeposílá proxy `/s/` správnou IP? — ANO, ověřeno.**
Byla to oprávněná obava: `next.config.js` rewrite je serverová proxy, takže by Umami mohlo
vidět IP originu místo návštěvníka — což by tiše rozbilo `IGNORE_IP`, hashování session
i geolokaci. **Měření to vyvrací:** beacon z prohlížeče na `vzdelanibudoucnosti.cz`
i `hry.*` vrací **403**, a `forbidden()` je v `route.ts:147` jediné místo, které 403 vrací —
tedy `hasBlockedIp()` moji domácí IP korektně poznalo. Proxy IP přeposílá správně.

**3. Monitoring je reálnější zdroj šumu než crawleři.**
Prosté HTTP kontroly se k beaconu nedostanou, ale **browser checks Checkly, Better Stack
Playwright a Pingdom transaction checks JS spouštějí — a posílají obyčejný Chrome
User-Agent bez bot tokenu**, takže je `isbot` nechytí. Pokud takový monitoring na weby
nasadíme, jejich IP patří do `IGNORE_IP` (published listy:
`betteruptime.com/ips.txt`, `api.uptimerobot.com/meta/ips`, fixní sada Checkly).

**4. `isbot` nechávat na `^5.2.1`.** Verze 5.2.0 měla regresi, která označovala
in-app prohlížeč Facebooku za bota ([isbot#314](https://github.com/omrilotan/isbot/issues/314)) —
downgrade pod 5.2.1 by tiše zahazoval skutečné návštěvy. Do budoucna pozor: v6 má zrušit
staré názvy exportů a Umami importuje legacy `{ isbot }` (`route.ts:2`, `record/route.ts:1`).

**5. Crawler IP listy pro `/api/send` nemá smysl řešit** — crawleři JS nespouštějí, takže
nedorazí. Relevantní jsou jen pro serverovou vrstvu `/api/px` na hlavním webu, která je
zapisuje. Tam už bot filtr existuje a vznikl z tvrdé zkušenosti: předchozí tabulka
`public.pageview` měla 1,59 M řádků, z toho ~97 % botů.

**Co jsme neověřili:** jestli je `x-vercel-ja4-digest` dostupný aplikačnímu kódu
(zdroje Vercelu si odporují). Na závěru to nic nemění — první-party bot klasifikace
od Vercelu v hlavičkách není.

## 5. Cílová architektura

Původní návrh v téhle sekci posílal pageviews z `middleware.ts`. **To padlo** — kvůli
F15 (hlavní web to už jednou zavedl a zrušil pro 16 656 invokací za 24 h) a kvůli 4.3
bod 1 (prefetch se v middleware spolehlivě odfiltrovat nedá). Obojí je doložené číslo,
ne názor.

Zůstává tohle rozdělení:

```
                    ┌─────────────────────────────────────┐
   návštěvník ──────┤ tracker v prohlížeči přes /s/ proxy │
                    │  • pageview        ← ZŮSTÁVÁ TADY   │  same-origin,
                    │  • Core Web Vitals                  │  adblock ho neblokuje
                    │  • screen, device                   │
                    └──────────────┬──────────────────────┘
                                   │  stejné sessionId
                    ┌──────────────┴──────────────────────┐
   backend  ────────┤ serverový handler (Node / Worker)   │
                    │  • konverze: registrace, platba     │  → neblokovatelné,
                    │  • payload.ip + payload.userAgent   │    bez prefetch problému
                    └─────────────────────────────────────┘
                                   │
                          /s/api/send → Umami
```

**Rozdělení odpovědnosti:**

| | Kdo posílá | Proč právě on |
|---|---|---|
| pageview | **klient** | prefetch a boti by ze serveru nafoukli čísla; proxy `/s/` už adblock řeší |
| Core Web Vitals, screen | **klient** | server je nemá odkud vzít (4.2) |
| konverze z backendu | **server** | vzniká při skutečné akci, nezávisí na tom, že uživatel zůstane na stránce |
| konverze čistě v UI | klient | server o kliknutí neví |

**Pravidlo, které se nesmí porušit:** pageview posílá **jen jedna vrstva**. Dnes klient,
a to se nemění. Kdyby se někdy přidala serverová, musí se ta klientská ve stejném commitu
vypnout — jinak se všechno počítá dvakrát.

Hlavní web má `data-auto-pageview="false"` a pageviews posílá ručně přes `trackUmamiPageview`,
takže tuhle podmínku splňuje už teď.

### 5.1 Serverové odesílání konverzí — jeden sdílený modul, ne kód per web

Zadání bylo „ať to máme připravené a neřešíme to per web". Runbook dnes říká
*„`umami.ts` a `trackedHost.ts` se kopírují, ne importují"* — a to je přesně to,
co se má změnit. Šest webů znamená šest kopií, které se rozejdou.

**Návrh: interní balíček `@vzb/analytics`** (git dependency nebo privátní registry),
který obsahuje to, co je opravdu společné, a všechno webově specifické bere z konfigurace.

| Vrstva | Obsah | Kde se liší per web |
|---|---|---|
| `core/` | fronta, dedupe pageviews, `toTrackedUrl`, `sanitizeBeacon`, `toEventProps` | nijak |
| `server/` | `sendUmamiEvent()` — odeslání konverze z backendu | nijak |
| `react/` | `<UmamiAnalytics>` pro App Router i Pages Router | nijak |
| `config` | `trackedHosts`, `blockedPathPrefixes`, `allowedQueryKeys`, `allowedPropKeys`, `eventNames` | **všechno** |

Konfigurace se předává jednou, při inicializaci — ne přes kopírované konstanty.

**Serverový odesílač, kontrakt:**

```ts
// @vzb/analytics/server — tvar, ne hotový kód
export async function sendUmamiEvent({ name, props, request, waitUntil }) {
  const body = {
    type: 'event',
    payload: {
      website: config.websiteId,
      hostname: config.primaryHost,
      url: toTrackedUrl(new URL(request.url).pathname + search),
      name,
      data: toEventProps(props),
      // Bez těchhle dvou spadnou všichni návštěvníci do jedné session
      ip: clientIpFrom(request),
      userAgent: request.headers.get('user-agent'),
    },
  }

  const send = fetch(`${config.hostUrl}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})           // měření nesmí shodit konverzi

  waitUntil ? waitUntil(send) : void send
}
```

**Na co si dát pozor — každý bod stojí na něčem ověřeném:**

- **IP se nebere z levé strany `x-forwarded-for`.** Umami sice sám bere první položku
  zleva (`src/lib/ip.ts:63`), ale tu **může klient podvrhnout** a přisvojit si cizí
  `sessionId`. Hlavní web tuhle lekci má zapsanou v `lib/analytics/clientIp.ts:6-11`:
  preferuje `x-vercel-forwarded-for` (platformní, nepodvrhnutelná) a z `x-forwarded-for`
  bere **poslední** položku. `clientIpFrom()` musí dělat totéž. Pozor na kontext:
  na deploymentu *měřeného webu* je `x-vercel-forwarded-for` IP návštěvníka a je správná;
  na deploymentu *Umami* je to IP toho webu — proto se na instanci nastavuje
  `CLIENT_IP_HEADER=x-real-ip`, ne tahle hlavička.
  Souvisí s **F14** — na instanci nastavit `CLIENT_IP_HEADER=x-real-ip`.
- **`BUILD_GEO=1` na instanci je předpoklad.** Bez něj u serverových událostí nevznikne
  žádná geolokace (a před opravou `57f733070` to bylo rovnou 500). Viz 4.0.
- **Sanitizace URL platí i tady.** `toTrackedUrl` je whitelist, ne blacklist —
  `/online/[token]`, `?email=`, herní PINy. To je jediné místo, kde se dá způsobit
  únik osobních údajů.
- **UTM a click ID musí v `allowedQueryKeys` zůstat** (`utm_*`, `gclid`, `fbclid`,
  `msclkid`, `sznclid`), jinak zmizí atribuce kampaní. Umami je parsuje z `url`
  (`route.ts:210-222`).
- **Nikdy `await` v cestě odpovědi.** `waitUntil`, nebo fire-and-forget s `.catch()`.
  Konverze se nesmí rozbít proto, že je Umami pomalé.
- **`IGNORE_IP` funguje dál a správně:** blokuje se přeposlaná IP návštěvníka
  (`route.ts:147`), ne IP serveru.

**Co balíček řeší navíc, i bez server-side:** dnes je na hlavním webu čtyřikrát jiný název
pro dvě hodnoty — `UMAMI_HOST_URL` vs `UMAMI_URL`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID`
vs `UMAMI_WEBSITE_ID` (digest si čte vlastní dvojici). Balíček tenhle kontrakt sjednotí
a `.env.example` bude jeden.

### 5.2 Jak se obě vrstvy „spojí" — a co se nespojí

Nespojují se do jednoho záznamu. Každá událost je **vlastní řádek** v `website_event`
a pojí je jen společné `session_id` (a `visit_id`). Dashboard je agreguje přes ně.

| Zdroj | `event_type` | Co nese |
|---|---|---|
| middleware (server) | `pageView` | url, referrer, UTM, click ID, hostname |
| tracker (klient) | `performance` | `lcp`, `inp`, `cls`, `fcp`, `ttfb` |
| tracker (klient) | `customEvent` | `event_name` + `event_data` |

Tohle funguje přesně tak, jak se čeká — session je `uuid(sourceId, ip, userAgent, salt)`,
takže obě vrstvy trefí stejnou session, aniž by se cokoli páruje.

**Co se ale nespojí: vlastnosti návštěvníka.**

V relačním režimu (což je náš případ — bez ClickHouse) `website_event` **nemá** sloupce
`browser`, `os`, `device`, `screen`, `language`, `country`. Ty existují **jen na tabulce
`session`** (`prisma/schema.prisma`, model `Session`) a zapisuje je `createSession`
příkazem `on conflict (session_id) do nothing`
(`src/queries/sql/sessions/createSession.ts`).

Tedy: **zapíšou se jednou, prvním requestem, a už nikdy se nepřepíšou.**
A první je vždycky server — middleware běží na requestu, který teprve vrací HTML,
dávno předtím, než prohlížeč spustí JS.

Konkrétní důsledky:

| | Dopad |
|---|---|
| `screen` | **Zůstane prázdný napořád.** Report rozlišení obrazovky bude prázdný. Klient ho pošle, ale `do nothing` ho zahodí. |
| `device` | `getDevice()` (`src/lib/detect.ts:48`) bere typ z User-Agentu, takže **mobile / tablet / desktop fungují dál správně**. Ztrácí se jen kategorie `laptop`, která vzniká výhradně z šířky obrazovky ≤ 1920 px. Všechno, co je dnes `laptop`, bude `desktop`. |
| `browser`, `os` | Z User-Agentu, server ho má → beze změny. |
| `language` | Z `Accept-Language` → funguje. |
| `country` / `region` / `city` | Z GeoLite2 místo Vercel hlaviček (viz 4.3 bod 4) → funguje, jiná přesnost. |

Cena hybridu je tedy **report rozlišení obrazovky a kategorie `laptop`**. Nic víc.
Není to blocker, ale je lepší to vědět předem než se pak divit prázdnému grafu.

### 5.3 `pocitacedetem.cz` je výjimka

WordPress nemá middleware. Varianty, v pořadí preference:

1. **Klientský tracker přes proxy** jako ostatní weby. Proxy `/s/` se na WordPressu udělá
   v `.htaccess`/Nginx nebo Cloudflare Workerem (Cloudflare tam už je — běží Cloudflare
   Insights). Pokrývá pageviews i Core Web Vitals.
2. **Vlastní PHP mu-plugin** volající `/api/send` na `template_redirect` neblokujícím
   requestem — jen pro serverové konverze, ne pro pageviews.
3. **Cloudflare Worker** dělající totéž na hraně.

> ⚠️ **Nepoužívat plugin `umami-wp-connect` ani jeho forky.**
> Oficiální stránka integrací Umami ho doporučuje, ale odkaz je mrtvý a **celý GitHub účet
> `ceviixx` je smazaný** — ověřeno nezávisle 2026-09-09: `github.com/ceviixx` → **404**,
> `github.com/ceviixx/umami-wp-connect` → **404**, kontrolní `github.com/mikecao` → 200.
>
> Plugin má natvrdo `define('UMAMI_CONNECT_GITHUB_USER', 'ceviixx')` a jeho self-updater
> z toho účtu **stahuje a instaluje release ZIPy**. Ten username je dnes volný
> k registraci, takže kdokoli si ho zaregistruje může doručit libovolné PHP do všech
> existujících instalací. Forky (`First8Marketing/first8marketing-track`) tuhle konstantu
> dědí.
>
> Druhý oficiálně doporučovaný plugin (`integrate-umami` na wordpress.org) žije, ale umí
> **jen klientské měření** — na serverové konverze se nedá použít. Varianta 2 se proto
> píše od nuly, ne forkem.

---

## 6. Plán změn

Kroky jsou v pořadí, v jakém se mají dělat. Krok 0 je hotový v tomhle repu.

### Krok 0 — odblokovat instanci ✅ *(hotovo, zbývají dvě env proměnné)*

| | Stav |
|---|---|
| Oprava 500 u chybějící geo databáze (F13) | ✅ `57f733070` — `src/lib/detect.ts` + 3 testy |
| CI na forku (F9) | ✅ `.github/workflows/ci-fork.yml` |
| Konfigurační runbook (F10) | ✅ `vzb-docs/umami-instance-config.md` |
| **`BUILD_GEO=1`** ve Vercel env `vzb-umami` | ⬜ nutné, jakmile se začne posílat `payload.ip` |
| **`CLIENT_IP_HEADER=x-real-ip`** (F14) | ⬜ zavře obcházení `IGNORE_IP`, udělat hned |

Obě proměnné jsou změna v dashboardu, ne v kódu. `CLIENT_IP_HEADER` nemá na nic
negativní dopad a řeší bezpečnostní díru — nemá smysl s ním čekat.

Po nasazení ověřit sondou z `umami-instance-config.md`:
`true-client-ip: 8.8.8.8` má nově vracet **403**, ne 200.

### Krok 1 — sdílený balíček `@vzb/analytics` *(jádro zadání „neřešit per web")*

Podle návrhu v 5.1. Vzniká vytažením `lib/analytics/` z hlavního webu, který má tuhle
vrstvu zdaleka nejvyzrálejší — a hlavně má v komentářích zapsané chyby, které už jednou
nastaly (fronta kvůli 0 ze 46 událostí, dedupe pageviews, `sanitizeBeacon` u Core Web
Vitals, whitelist místo blacklistu).

Co se z hlavního webu vytáhne beze změny: fronta, dedupe, `toTrackedUrl`, `sanitizeBeacon`,
`toEventProps`, `visitorHash`, `clientIp`.
Co se stane konfigurací: `trackedHosts`, `blockedPathPrefixes`, `allowedQueryKeys`,
`allowedPropKeys`, názvy událostí.
Co se dopíše: **App Router varianta** `<UmamiAnalytics>` (hlavní web je Pages Router,
většina ostatních bude App Router) a `sendUmamiEvent()` pro backend.

**Nepřepisovat sémantiku fronty.** Adresa se musí zachytit v okamžiku *zařazení*,
ne odeslání — přesně tahle chyba je v komentářích popsaná jako už jednou opravená.

### Krok 2 — dorovnat pokrytí *(P0, dá se dělat souběžně s krokem 1)*

Čtyři weby na Umami. **Na serveru Umami se nemění nic** — žádný deploy, žádná migrace.

| Web | Poznámka |
|---|---|
| `knihovna.vzdelanibudoucnosti.cz` | P0 — dnes nula dat. Nejdřív zjistit repo a framework. |
| `code.vzdelanibudoucnosti.cz` | Next.js/Vercel → proxy `/s/` standardně |
| `pythongo.cz` | Next.js/Vercel → totéž |
| `www.pocitacedetem.cz` | WordPress → viz 5.3 |

Pro každý web projít otázky ze sekce 1 runbooku, zejména **samostatný vs. sdílený
`websiteId`**, **které cesty a query nesmí ven**, a `data-domains` včetně `www.`
(u `pocitacedetem.cz` je produkční hostname s `www.` — bez něj se neměří nic
a v konzoli není žádná hláška).

Pokud je balíček z kroku 1 hotový, jde to rychleji; pokud ne, dá se to udělat i postaru
podle runbooku a na balíček přejít později.

### Krok 3 — server-side konverze *(tam, kde má server-side jednoznačnou hodnotu)*

Události, které vznikají na **backendu** — odeslaná registrace, potvrzená platba,
dokončená objednávka — posílat do Umami přímo ze serverového handleru přes
`sendUmamiEvent()` z kroku 1.

- Nikdo je nezablokuje a nezávisí na souhlasu s marketingovými cookies.
- Nemají problém s prefetchem ani s boty — vznikají jen při skutečné akci.
- Handler má IP i User-Agent původního requestu, takže se podle 4.4 napojí na správnou
  session návštěvníka.
- Je to model, který doporučují Segment i PostHog (4.5).

Konkrétně na hlavním webu: `registration_submit` se dnes posílá z prohlížeče
(`components/RegisterModal/common.ts`) a spoléhá na to, že uživatel po odeslání zůstane
na stránce — u platební brány přitom rovnou odchází na Comgate. Serverová varianta
tuhle ztrátu odstraní.

**Předpoklad:** `BUILD_GEO=1` z kroku 0, jinak konverze nebudou mít geolokaci.

### Krok 4 — uklidit duplicitní a mrtvá měření *(P1)*

1. **`pythongo.cz`: odstranit `UA-133426578-2`** a `analytics.js`. Bez podmínek —
   ta property je od července 2023 mrtvá.
2. **`pocitacedetem.cz`: jedna cesta do GA4**, ne dvě. Doporučeně GTM (`GTM-TLTMG2P`),
   MonsterInsights vypnout.
3. **Vercel Insights vypnout** na `vzdelanibudoucnosti.cz`, `code.*` a `pythongo.cz`;
   **Cloudflare Insights** na `pocitacedetem.cz`.
4. **`/api/px` na hlavním webu (F7):** rozhodnout, co s ním. Má vlastní bot filtr, vlastní
   `visitor_hash` a napojení na atribuci registrací — **není to duplikát Umami, ale jiná
   vrstva**. Minimum: doplnit mu vyloučení interního provozu, aby se čísla dala srovnat.

### Krok 5 — provozní hygiena *(P2)*

1. **Retence dat (F11).** Externí scheduled job (Vercel Cron + route mazající
   `website_event` starší než N měsíců ve schématu `analytics`). Nejdřív ale změřit
   reálný růst — s šesti weby to nemusí být letos aktuální.
2. **Ověřování měření (F12).** Do runbooku doplnit nemutující sondu
   z `umami-instance-config.md` a fakt, že se testuje z mobilních dat, ne z kanceláře.

### Krok 6 — aktualizovat runbook *(malá změna, velký dopad)*

`pridani-webu-do-umami.md`: opravit sekci 0 (`hry.*` už na Umami **je**), doplnit
tabulku pokrytí ze sekce 1 a nahradit kapitolu „kopíruj `umami.ts`" odkazem na balíček
z kroku 1.

### Volitelně — změřit, kolik měření uniká

Už to není brána pro nic v tomhle plánu (middleware pageviews padly), ale je to levné
a užitečné číslo: porovnat pageviews z Umami proti requestům na tytéž cesty z Vercel logů
za stejné období, po odečtení botů, prefetche a `/_next/*`. Rozdíl je to, co `/s/` proxy
nezachytí. Kdyby vyšel výrazně vysoký, stojí za to se k serverovým pageviews vrátit —
ale s vědomím F15 a 4.3.

## 7. Co v tomhle plánu vědomě není

- **Čistě server-side bez klientské vrstvy.** Šlo by to, ale přišli byste o Core Web
  Vitals a konverzní události — viz 4.2. Hybridní model splní zadání
  („neblokovatelné měření návštěv") a tyhle věci si nechá. Report rozlišení obrazovky
  a kategorii `laptop` ztratíte tak jako tak, i v hybridu — viz 5.2.
- **ClickHouse.** Při šesti webech téhle velikosti Postgres stačí. Přehodnotit, až
  bude dashboard pomalý — ne preventivně.
- **Upgrade Umami.** Fork sedí na `v3.3.1` = aktuální upstream `master`.
- **Session replay / heatmapy.** Nahrává DOM včetně formulářů → patří do zásad
  zpracování osobních údajů. Default zůstává vypnuto.

---

## 8. Doporučené pořadí

```
Krok 0 (instance)   ✅ hotovo v repu; zbývají 2 env proměnné — 10 minut
   │
   ├─ Krok 1 (balíček @vzb/analytics) ──┬─ Krok 2 (dorovnat pokrytí)
   │                                    └─ Krok 3 (server-side konverze)
   │
   ├─ Krok 4 (úklid duplicit)   ← nezávislé
   ├─ Krok 5 (hygiena)          ← nezávislé
   └─ Krok 6 (runbook)          ← průběžně
```

**Udělat hned (pod hodinu):** `CLIENT_IP_HEADER=x-real-ip` (zavře F14),
smazat mrtvý UA z `pythongo.cz` (F4), opravit runbook (F8).

**Největší hodnota:** Krok 2. O čtyřech ze šesti webů dnes nevíte nic a žádná
architektura měření to nenahradí.

**Jádro zadání „neřešit per web":** Krok 1. Bez něj se každý další web řeší kopírováním
`lib/analytics/` a šest kopií se rozejde.

**Co nedělat:** nestavět pageviews z middleware. Není to názor — hlavní web to už jednou
zavedl a zrušil (F15, 16 656 invokací za 24 h) a prefetch se v middleware spolehlivě
odfiltrovat nedá (4.3).

**Nejrizikovější místo celého plánu:** sanitizace URL v `toTrackedUrl` (5.1). Je to
whitelist, ne blacklist, a je to jediné místo, kde se dá způsobit únik osobních údajů —
`/online/[token]`, `?email=`, herní PINy. Při přenosu do balíčku si zaslouží vlastní testy
a ruční ověření na každém webu zvlášť.

---

## 9. Zdroje k sekci 4.5

- [Plausible — Events API](https://plausible.io/docs/events-api) (požadavky na `X-Forwarded-For` a `User-Agent`)
- [Analytics Mania — Introduction to GTM Server-Side Tagging](https://www.analyticsmania.com/post/introduction-to-google-tag-manager-server-side-tagging/)
- [Piwik PRO — Server-side tracking and server-side tagging](https://piwik.pro/blog/server-side-tracking-first-party-collector/)
- [Stape — Client-Side vs Server-Side Tracking](https://stape.io/blog/server-side-tagging-versus-client-side-tagging)
- [Next.js — Guides: Prefetching](https://nextjs.org/docs/app/guides/prefetching) (analytika patří do `useEffect`, ne do renderu)
- [vercel/next.js#85836](https://github.com/vercel/next.js/issues/85836), [#63728](https://github.com/vercel/next.js/issues/63728), [diskuze #37736](https://github.com/vercel/next.js/discussions/37736) — chybějící prefetch hlavičky v middleware
