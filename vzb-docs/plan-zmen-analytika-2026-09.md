# Plán změn — analytika portfolia VZB

**Datum auditu:** 2026-09-09
**Rozsah:** instance Umami `analytics.vzdelanibudoucnosti.cz` + všech 5 webů portfolia
**Branch:** `worktree-audit-multisite` (worktree z `master` @ `ca661c705`, v3.3.1)
**Navazuje na:** `vzb-docs/pridani-webu-do-umami.md` (postup napojení jednoho webu —
tenhle dokument ho nenahrazuje, řeší vrstvu nad ním: *které* weby a *proč*)

---

## 1. Naměřený stav (2026-09-09, reálné načtení v prohlížeči)

Každý web byl otevřen v Chromiu a odchycen network traffic. Grep do HTML nestačí —
hlavní web vkládá tracker až klientsky, ve zdrojáku není ani slovo „umami".

| Web | Umami | GA4 | Universal Analytics | Vercel Insights | GTM | vlastní `/api/px` | další |
|---|---|---|---|---|---|---|---|
| `vzdelanibudoucnosti.cz` | ✅ `/s/` proxy | ✅ `G-G1Q4FEGBBQ` | – | ✅ | ✅ | ✅ (204) | – |
| `hry.vzdelanibudoucnosti.cz` | ✅ `/s/` proxy | – | – | – | – | – | – |
| `knihovna.vzdelanibudoucnosti.cz` | ❌ | ❌ | – | – | – | – | **nic** |
| `www.pocitacedetem.cz` (WordPress) | ❌ | ✅ **2×** `G-66ZG5QWT77` + `G-RDD0RQ1670` | – | – | ✅ `GTM-TLTMG2P` | – | Cloudflare Insights |
| `pythongo.cz` | ❌ | ✅ `G-2T3SDFG8KP` | ⚠️ `UA-133426578-2` + `analytics.js` | ✅ | – | – | doubleclick |

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

**F2 — `pocitacedetem.cz` a `pythongo.cz` nejsou v Umami.**
Tři z pěti webů portfolia jsou mimo instanci, kterou provozujeme. „Analytika pro naše
weby" dnes fakticky pokrývá 2/5. Srovnání napříč portfoliem nejde udělat vůbec —
ani ručně, protože GA4 a Umami počítají session jinak.

**F3 — `pythongo.cz` načítá mrtvý Universal Analytics.**
`gtag/js?id=UA-133426578-2` + `google-analytics.com/analytics.js`. UA je vypnuté od
1. 7. 2023, ta data nikam nejdou. Zůstal jen požadavek na třetí stranu navíc —
tedy nulová hodnota a nenulová GDPR stopa.

### P1 — kvalita a interpretovatelnost dat

**F4 — hlavní web běží na čtyřech paralelních stackech současně.**
Umami + GA4 + Vercel Insights + vlastní `/api/px`. Čtyři různá čísla návštěvnosti,
čtyři různé definice session, čtyři věci k pokrytí v souhlasu. Až se čísla rozejdou
(a rozejdou se), není definované, které je to „správné".

**F5 — `pocitacedetem.cz` posílá pageview dvakrát do dvou GA4 property.**
`G-66ZG5QWT77` jede přes WP plugin *google-analytics-for-wordpress* (MonsterInsights),
`G-RDD0RQ1670` přes `GTM-TLTMG2P`. K tomu Cloudflare Insights jako třetí měření.

**F6 — runbook `pridani-webu-do-umami.md` je zastaralý.**
Tvrdí, že `hry.vzdelanibudoucnosti.cz` je „zatím bez Umami" a označuje ho za
*pravděpodobného prvního kandidáta*. Měření tam ale už běží (ověřeno dnes).
Kdo runbook vezme doslova, napojí web podruhé.

### P2 — provoz instance

**F7 — na forku neběží žádné CI.**
`.github/workflows/ci.yml` má `if: github.repository == 'umami-software/umami'`,
takže se na `vzdelanibudoucnosti-webs/umami` celý job přeskočí. Vercel deployuje
`master` bez `pnpm test` a bez build gate — jediné, co chybu odhalí, je až samotný
Vercel build.

**F8 — konfigurace nasazení žije jen ve Vercel dashboardu.**
V repu není `vercel.json`. Env proměnné (`DATABASE_URL`, `DIRECT_DATABASE_URL`,
`TRACKER_SCRIPT_NAME`, `IGNORE_IP`, …) nemají v gitu ani seznam. Fakta jsou zachycená
v `CLAUDE.md`, ale ne strojově — po výpadku přístupu se nastavení rekonstruuje ručně.

**F9 — žádná retence dat.**
Self-hosted v3.3.1 nemá mazání podle stáří (jen *retention report*, což je něco jiného).
Instance je relational-only nad sdíleným Supabase Postgresem ve schématu `analytics`.
S pěti weby databáze poroste bez stropu — a je to sdílený stroj s hlavním webem.

**F10 — `IGNORE_IP` blokuje vlastní síť, takže si měření nejde ověřit.**
Ověřeno dnes: `/s/api/send` vrací z téhle sítě **403** na `vzdelanibudoucnosti.cz`
i na `hry.vzdelanibudoucnosti.cz`. Tracker je v pořádku, ale nikdo si to odsud
nepotvrdí — a prázdný dashboard po testu vypadá jako rozbité měření.

### Co je naopak v pořádku (a nemá se na to sahat)

- Instance je zdravá, rychlá, API správně gated (401), CSP i HSTS nasazené.
- Proxy `/s/stats.js` funguje a je same-origin → adblocky ji neblokují a projde CSP `'self'`.
- Fork bez divergence = upgrade Umami je `git merge upstream/master`, žádné konflikty.
- Whitelist adres a `data-before-send` na hlavním webu jsou navržené správně
  (Core Web Vitals beacon by jinak obešel sanitizaci).

---

## 3. Plán změn

### Krok 1 — rozhodnout, co je jediný zdroj pravdy *(nejde delegovat, blokuje zbytek)*

Bez tohohle rozhodnutí jsou kroky 2–4 jen přesouvání skriptů. Otázka zní:
**má být Umami primární analytika portfolia, nebo doplněk vedle GA4?**

- **Varianta A — Umami primární** (odpovídá tomu, proč instance vznikla):
  Umami na všech 5 webech, GA4 zůstane jen tam, kde na něm visí konkrétní potřeba
  (Google Ads konverze, propojení se Search Console). Vercel Insights a Cloudflare
  Insights pryč — neposkytují nic, co Umami nemá.
- **Varianta B — status quo, jen doplnit chybějící weby:** Umami všude, GA4 všude,
  duplicita zůstává. Levnější na čas, ale F4/F5 se tím nevyřeší.

Doporučení: **A**. Důvod je praktický, ne ideologický — dokud běží čtyři měření,
nikdo nedokáže říct, které číslo se má reportovat, a rozdíly se vysvětlují místo
toho, aby se používaly.

**Výstup kroku:** jedna věta v `vzb-docs/`, který stack je na kterém webu závazný.

### Krok 2 — dorovnat pokrytí *(P0, nezávislé na kroku 1)*

Tři weby na Umami, podle existujícího runbooku `pridani-webu-do-umami.md`.
**Na serveru Umami se nemění nic** — žádný deploy, žádná migrace, žádná env proměnná.

| Web | Stack | Poznámka k napojení |
|---|---|---|
| `knihovna.vzdelanibudoucnosti.cz` | ? (zjistit repo a framework) | P0, nemá dnes žádná data |
| `pythongo.cz` | Next.js / Vercel | proxy `/s/` půjde stejně jako u hlavního webu |
| `www.pocitacedetem.cz` | WordPress | **nejde přes `next.config.js`** — proxy musí být přes `.htaccess`/Nginx nebo Cloudflare Worker; nebo se výjimečně poveze přímo na `analytics.vzdelanibudoucnosti.cz` s vědomím, že adblock část měření sebere |

Pro každý web se musí projít otázky ze sekce 1 runbooku, zejména:
- **samostatný `websiteId`, nebo sdílený** (sekce 2 runbooku — session se počítá
  jako `uuid(websiteId, ip, userAgent, salt)`, hostname do ní nevstupuje);
- **které cesty a query parametry nesmí ven** — u `knihovna.*` a `pythongo.cz` se
  ptát explicitně na tokeny, PINy a e-maily v URL;
- `data-domains` včetně `www.` varianty (u `pocitacedetem.cz` je produkční hostname
  s `www.`, bez něj se neměří nic a v konzoli není hláška).

### Krok 3 — uklidit duplicitní a mrtvá měření *(P1, po kroku 1)*

1. **`pythongo.cz`: odstranit `UA-133426578-2`** a `analytics.js`. Bezpodmínečně —
   ta property je od července 2023 mrtvá, nejde o žádnou ztrátu dat.
2. **`pocitacedetem.cz`: zvolit jednu cestu do GA4.** Buď WP plugin, nebo GTM, ne obojí.
   Doporučeně GTM (`GTM-TLTMG2P`) a MonsterInsights vypnout — GTM se dá spravovat centrálně.
3. **Vercel Insights / Cloudflare Insights:** vypnout tam, kde je Umami. Duplikují
   pageviews a Vercel Insights se navíc účtuje.
4. **`/api/px` na hlavním webu:** vyjasnit vztah k Umami. Píše do `analytics.pageview_event`
   nezávisle a **nemá vlastní vyloučení interního provozu** — `IGNORE_IP` se ho netýká,
   takže vaše vlastní návštěvy v něm jsou. Buď doplnit stejnou exclusion logiku,
   nebo ho zrušit ve prospěch Umami.

### Krok 4 — provozní hygiena instance *(P2, kdykoliv)*

1. **Zapnout CI na forku.** Přidat `|| github.repository == 'vzdelanibudoucnosti-webs/umami'`
   do podmínky v `.github/workflows/ci.yml`, nebo (čistší, bez konfliktu s upstreamem)
   založit vlastní `.github/workflows/ci-fork.yml`, který na forku pouští `pnpm test`
   a `pnpm build` se `SKIP_DB_CHECK=1`. Tohle je jediná změna v tomhle plánu,
   která sahá do kódu repa.
2. **Retence dat (F9).** Umami ji neumí → externí scheduled job. Nejjednodušší
   varianta: Vercel Cron + route, která smaže `website_event` starší než N měsíců
   ve schématu `analytics`. Před tím ale změřit, jak databáze reálně roste —
   s 5 weby to nemusí být letos aktuální. **Neřešit dřív než po kroku 2**, kdy budou
   známá reálná čísla.
3. **Zdokumentovat Vercel env do gitu (F8).** Ne hodnoty — seznam a význam.
   Stačí `vzb-docs/vercel-env.md` s tím, co `CLAUDE.md` už ví (`?schema=analytics`
   na obou URL, `TRACKER_SCRIPT_NAME=stats.js` včetně přípony, `COLLECT_API_ENDPOINT`
   nikdy nenastavovat).
4. **Definovat, jak se měření ověřuje (F10).** Do runbooku doplnit, že se testuje
   z mobilních dat, ne z kanceláře, a proč. Alternativa: dočasně vyjmout IP z `IGNORE_IP`
   na dobu testu.

### Krok 5 — aktualizovat runbook *(malá změna, velký dopad)*

V `vzb-docs/pridani-webu-do-umami.md` opravit sekci 0: `hry.vzdelanibudoucnosti.cz`
už na Umami **je**, není to kandidát. Doplnit tabulku pokrytí ze sekce 1 tohoto
dokumentu, aby byl runbook zároveň přehledem stavu.

---

## 4. Co v tomhle plánu vědomě není

- **ClickHouse.** Při pěti webech téhle velikosti nemá Postgres problém. Zvažovat
  až kdyby dashboard začal být pomalý, ne preventivně.
- **Upgrade Umami.** Fork sedí na `v3.3.1` = aktuální upstream `master`. Není co dělat.
- **Zásahy do serveru Umami kvůli novým webům.** Napojení webu je čistě klientská
  změna v jeho repu. Server se nedotýká.
- **Session replay / heatmapy.** Nahrává DOM včetně formulářů → patří do zásad
  zpracování osobních údajů. Default zůstává vypnuto.

---

## 5. Doporučené pořadí

```
Krok 1 (rozhodnutí)  ──┬── Krok 3 (úklid duplicit)
                       └── Krok 5 (runbook)
Krok 2 (dorovnat pokrytí)  ← nezávislé, dá se začít hned
Krok 4 (hygiena instance)  ← nezávislé, 4.1 je 10 minut
```

Nejrychlejší hodnota za nejmíň práce: **F3** (smazat mrtvý UA z `pythongo.cz`),
**F7** (zapnout CI) a **F6** (opravit runbook) — dohromady pod hodinu.
Největší hodnota celkově: **Krok 2**, protože bez něj se o třech z pěti webů
nedá říct vůbec nic.
