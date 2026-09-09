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

1. **Prefetch.** Next.js `<Link>` si předtahuje RSC payload pro odkazy ve viewportu.
   To jsou requesty na server pro stránky, které nikdo neviděl. Bez filtru na
   `Next-Router-Prefetch` / `Sec-Purpose: prefetch` vám pageviews **nafouknou**.
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

## 5. Cílová architektura: server-side jako pravda, klient jako doplněk

```
                    ┌─────────────────────────────────────┐
   návštěvník ──────┤ middleware.ts na webu (server-side) │
                    │  • pageview                         │  → 100 %, neblokovatelné
                    │  • payload.ip + payload.userAgent   │
                    │  • sanitizace URL                   │
                    └──────────────┬──────────────────────┘
                                   │  stejné sessionId
                    ┌──────────────┴──────────────────────┐
                    │ tracker v prohlížeči (obohacení)    │
                    │  • data-auto-pageview="false"       │  → jen to, co server neví
                    │  • Core Web Vitals                  │
                    │  • konverzní události               │
                    │  • screen                           │
                    └─────────────────────────────────────┘
                                   │
                          /s/api/send → Umami
```

**Pravidlo, které se nesmí porušit:** pageview posílá **jen jedna vrstva**.
Server. Klient má `data-auto-pageview="false"` a pageview neposílá nikdy —
jinak se všechno počítá dvakrát. Hlavní web tenhle atribut už má.

Když se klientská vrstva zablokuje (adblock, banner), přijdete o CWV a události
u toho návštěvníka — **ale ne o jeho návštěvu**. To je přesně to, co bylo zadáno.

### 5.1 Co musí umět serverová vrstva

Implementace je v každém webu vlastní, ale kontrakt je společný:

```ts
// middleware.ts — tvar, ne hotový kód
export async function middleware(request: NextRequest) {
  // 1. Vynechat prefetch — jinak se počítají stránky, které nikdo neviděl
  if (request.headers.get('next-router-prefetch')) return NextResponse.next()
  if (request.headers.get('sec-purpose')?.includes('prefetch')) return NextResponse.next()

  // 2. Sanitizace URL MUSÍ být i tady — whitelist z lib/analytics/umami.ts
  //    se na server nedostane sám a tokeny by šly do Umami syrové
  const url = toTrackedUrl(request.nextUrl)
  if (!url) return NextResponse.next()

  // 3. Odeslat na pozadí, aby to nepřidávalo latenci odpovědi
  event.waitUntil(fetch(`${UMAMI_HOST_URL}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'event',
      payload: {
        website: WEBSITE_ID,
        hostname: request.nextUrl.hostname,
        url,
        referrer: request.headers.get('referer'),
        language: request.headers.get('accept-language')?.split(',')[0],
        // BEZ TĚCHHLE DVOU SE VŠICHNI SLIJÍ DO JEDNÉ SESSION
        ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim(),
        userAgent: request.headers.get('user-agent'),
      },
    }),
  }))

  return NextResponse.next()
}
```

Na co si dát pozor:

- **Sanitizace URL se musí přenést na server.** Dnes žije v `lib/analytics/umami.ts`
  (`BLOCKED_PATH_PREFIXES`, `ALLOWED_QUERY_KEYS`) a běží v prohlížeči. Middleware ji
  obejde. **Tohle je jediná změna, kde hrozí únik osobních údajů, když se udělá špatně** —
  `/online/[token]`, herní PINy, `?email=` v query.
- **UTM a click ID se musí v `ALLOWED_QUERY_KEYS` udržet** (`utm_*`, `gclid`, `fbclid`,
  `msclkid`, `sznclid`), jinak přijdete o atribuci kampaní. Umami je parsuje
  z `url` (`route.ts:210-222`).
- **`waitUntil`, ne `await`.** Jinak si každou stránku zpomalíte o kolo na Umami.
- **`x-forwarded-for` se bere první položka zleva** — stejně jako to dělá Umami
  (`src/lib/ip.ts:63`).
- **`IGNORE_IP` funguje dál** a správně: blokuje se přeposlaná IP návštěvníka
  (`route.ts:147`), ne IP vašeho serveru.

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

1. **Cloudflare Worker** před webem (Cloudflare tam už je — běží Cloudflare Insights).
   Dělá totéž co middleware a řeší i proxy `/s/`.
2. **PHP mu-plugin** volající `/api/send` na `template_redirect`, neblokujícím requestem.
3. **Klientský tracker** jako dnes ostatní weby — s vědomím, že část měření sebere adblock.

---

## 6. Plán změn

### Krok 1 — pilot server-side na jednom webu *(dělat první, samostatně)*

**Kandidát: `hry.vzdelanibudoucnosti.cz`.** Je to jediný web, který má Umami a zároveň
**žádnou jinou analytiku** — takže je na něm vidět čistý rozdíl a nic se nerozbije.
Next.js App Router, tedy stejný tvar jako většina portfolia.

1. Přidat `middleware.ts` podle 5.1, klientský tracker nechat běžet **beze změny**.
2. Nechat běžet **48 hodin s oběma vrstvami** a porovnat:
   - kolik pageviews přibylo (= kolik vám dnes bere adblock),
   - kolik z toho je prefetch a boti (= o kolik je to nafouknuté),
   - sedí `sessionId` napříč vrstvami? (ověření sekce 4.4)
3. Teprve podle těch čísel vypnout klientský pageview.

Bez tohohle kroku se plán dělá naslepo. Poměr „ušlé kvůli adblocku" ku „nafouknuté
prefetchem" nejde odhadnout od stolu a rozhoduje o tom, jak agresivní filtry nastavit.

### Krok 2 — dorovnat pokrytí *(P0, nezávislé na kroku 1)*

Čtyři weby na Umami podle runbooku `pridani-webu-do-umami.md`.
**Na serveru Umami se nemění nic** — žádný deploy, žádná migrace, žádná env proměnná.

| Web | Poznámka |
|---|---|
| `knihovna.vzdelanibudoucnosti.cz` | P0 — dnes nula dat. Nejdřív zjistit repo a framework. |
| `code.vzdelanibudoucnosti.cz` | Next.js/Vercel → proxy `/s/` i middleware jdou standardně |
| `pythongo.cz` | Next.js/Vercel → totéž |
| `www.pocitacedetem.cz` | WordPress → viz 5.3 |

Pro každý web projít otázky ze sekce 1 runbooku, zejména **samostatný vs. sdílený
`websiteId`**, **které cesty a query nesmí ven**, a `data-domains` včetně `www.`
(u `pocitacedetem.cz` je produkční hostname s `www.` — bez něj se neměří nic
a v konzoli není žádná hláška).

### Krok 3 — uklidit duplicitní a mrtvá měření *(P1)*

1. **`pythongo.cz`: odstranit `UA-133426578-2`** a `analytics.js`. Bez podmínek —
   ta property je od července 2023 mrtvá, o nic nepřijdete.
2. **`pocitacedetem.cz`: jedna cesta do GA4**, ne dvě. Doporučeně GTM (`GTM-TLTMG2P`),
   MonsterInsights vypnout.
3. **Vercel Insights vypnout** na `vzdelanibudoucnosti.cz`, `code.*` a `pythongo.cz`;
   **Cloudflare Insights** na `pocitacedetem.cz`.
4. **`/api/px` na hlavním webu (F7):** rozhodnout. Buď mu doplnit stejné vyloučení
   interního provozu jako má Umami, nebo ho po nasazení server-side vrstvy zrušit —
   middleware dělá totéž a navíc správně.

### Krok 4 — provozní hygiena instance *(P2)*

1. **Zapnout CI na forku (F9).** Vlastní `.github/workflows/ci-fork.yml`, který pouští
   `pnpm test` a `pnpm build` se `SKIP_DB_CHECK=1`. Čistší než upravovat `ci.yml`,
   protože nekoliduje s upstream merge. **Jediná změna v tomhle plánu, která sahá
   do kódu tohoto repa.**
2. **Retence dat (F11).** Umami ji neumí → externí scheduled job (Vercel Cron + route
   mazající `website_event` starší než N měsíců ve schématu `analytics`).
   **Priorita roste s krokem 1** — server-side zvedne objem zápisů. Nejdřív ale
   změřit reálný růst, ne odhadovat.
3. **Zdokumentovat Vercel env do gitu (F10).** Ne hodnoty, jen seznam a význam:
   `?schema=analytics` na obou URL, `TRACKER_SCRIPT_NAME=stats.js` včetně přípony,
   `COLLECT_API_ENDPOINT` nikdy nenastavovat.
4. **Jak se měření ověřuje (F12).** Do runbooku: testuje se z mobilních dat, ne
   z kanceláře, protože `IGNORE_IP` vrací 403 a dashboard zůstane prázdný.

### Krok 5 — aktualizovat runbook *(malá změna, velký dopad)*

`pridani-webu-do-umami.md`: opravit sekci 0 (`hry.*` už na Umami **je**), doplnit
tabulku pokrytí ze sekce 1 a novou kapitolu o serverové vrstvě podle sekce 5.

---

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
Krok 1 (pilot na hry.*)  ──►  data, podle kterých se rozhodne zbytek
Krok 2 (dorovnat pokrytí)  ← nezávislé, dá se dělat souběžně
Krok 3 (úklid)             ← po kroku 1
Krok 4 (hygiena)           ← nezávislé; 4.1 je na 10 minut
Krok 5 (runbook)           ← průběžně
```

**Rychlá hodnota za málo práce:** smazat mrtvý UA z `pythongo.cz` (F4), zapnout CI (F9),
opravit runbook (F8) — dohromady pod hodinu.

**Největší hodnota:** Krok 2, protože o čtyřech ze šesti webů dnes nevíte nic.

**Nejrizikovější místo celého plánu:** sanitizace URL v serverové vrstvě (5.1).
Dnešní whitelist běží v prohlížeči a middleware ho obejde. Když se přenese špatně,
poletí do Umami tokeny, PINy a e-maily z adres. To je jediná část, která si zaslouží
ruční test na každém webu zvlášť.
