# Konfigurace instance Umami (`vzb-umami`)

Env proměnné Vercel projektu **`vzb-umami`** — co je nastavené, co má být nastavené a proč.
**Hodnoty tady nejsou**, jen názvy a význam. Zdroj pravdy zůstává Vercel dashboard;
tenhle soubor existuje proto, aby se nastavení dalo zrekonstruovat a aby se nediskutovalo
o věcech, které už jednou stály čas.

Ověřeno proti kódu na `master` @ `ca661c705` (v3.3.1) a proti živé instanci 2026-09-09.

---

## Databáze

| Proměnná | Poznámka |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler**, port 6543. Musí končit `?schema=analytics`. |
| `DIRECT_DATABASE_URL` | Supabase **session pooler**, port 5432. Taky `?schema=analytics`. |

`scripts/check-db.js:74` prohodí `DIRECT_DATABASE_URL` do `DATABASE_URL` pro podproces
`prisma migrate deploy`. Prisma 7 tady jede přes driver adapter, takže `datasource db`
v `prisma/schema.prisma` **záměrně nemá** `url` ani `directUrl` — URL přichází
z `prisma.config.ts`. **Nepřidávat je tam.**

---

## Tracker

| Proměnná | Hodnota | Proč |
|---|---|---|
| `TRACKER_SCRIPT_NAME` | `stats.js` | **Včetně přípony.** `next.config.ts:186` skládá rewrite jako `/${name}` a `.js` nedoplňuje. Přejmenování jen **přidává alias** — `/script.js` zůstává funkční. |
| `COLLECT_API_ENDPOINT` | **nikdy nenastavovat** | Weby mají `/s/api/send → /api/send` natvrdo v rewrites. Přejmenování endpointu zabije beacon tiše. |

Ověřeno: `/stats.js` i `/script.js` vrací 200, 4733 B, `cache-control: public, max-age=86400`.

---

## Vyloučení interního provozu

| Proměnná | Poznámka |
|---|---|
| `IGNORE_IP` | Seznam IP nebo CIDR oddělený čárkami. Čte `hasBlockedIp` (`src/lib/detect.ts`), odmítá události na `/api/send` s **403**. |
| `CLIENT_IP_HEADER` | **Nastavit na `x-real-ip`.** Viz níže — bez toho jde `IGNORE_IP` obejít. |

### `CLIENT_IP_HEADER=x-real-ip` — ověřená mitigace

`src/lib/ip.ts:5` má seznam `IP_ADDRESS_HEADERS` a **`true-client-ip` je v něm první**.
Vercel tuhle hlavičku nenastavuje ani nestriptuje, takže hodnota od volajícího vyhraje.
Endpoint `/api/send` je přitom `skipAuth: true` a `websiteId` je veřejné (je v HTML).

Změřeno 2026-09-09 nemutující sondou (`type:"identify"` bez `id` i `data` nic nezapisuje),
oběma cestami — přímo na instanci i přes proxy `/s/` na hlavním webu:

| Hlavička v requestu | Přímo na Umami | Přes `/s/` proxy |
|---|---|---|
| *(žádná)* | 403 | 403 |
| `x-forwarded-for: 8.8.8.8` | 403 | — |
| `x-vercel-forwarded-for: 8.8.8.8` | 403 | — |
| `x-real-ip: 8.8.8.8` | 403 | 403 |
| **`true-client-ip: 8.8.8.8`** | **200** | **200** |

`403` znamená, že Umami správně poznalo moji (blokovanou) IP. `200` znamená, že hodnota
z hlavičky přebila zjištění IP.

**Závěr: `true-client-ip` je jediný podvrhnutelný nosič — a funguje i přes veřejnou
proxy měřeného webu.** Kdokoli může obejít `IGNORE_IP` a vybrat si, pod jakou IP,
lokalitou a session se událost zapíše.

Oprava: `getIpAddress` (`src/lib/ip.ts:76-80`) při nastaveném `CLIENT_IP_HEADER` čte
**jen** tuhle hlavičku a seznam přeskočí. Správná hodnota je **`x-real-ip`**:

- **Není podvrhnutelná** — Vercel ji přepisuje (ověřeno oběma cestami, obojí 403).
- **Přežije proxy `/s/`** a nese IP návštěvníka, ne originu. To je klíčové a není to
  samozřejmé — viz níže.

> ⚠️ **`x-vercel-forwarded-for` použít NELZE**, i když se to nabízí jako „platformní,
> tedy nejbezpečnější". Na deploymentu Umami je to IP **měřeného webu**, ne návštěvníka,
> takže by se **všichni návštěvníci slili do jedné session**. Tahle varianta byla
> v dřívější verzi tohoto dokumentu doporučena omylem.

**Neruší to serverové odesílání událostí** — `payload.ip` má přednost před `getIpAddress`
úplně (`src/lib/detect.ts:131`).

**Zbytkové riziko:** `getIpAddress` použije vlastní hlavičku jen když je přítomná
(`ip.ts:78`); jinak propadne na původní seznam. Na Vercelu je `x-real-ip` nastavená vždy,
takže se to v praxi nestane — ale ta cesta v kódu existuje.

**Po nastavení ověřit:** `true-client-ip: 8.8.8.8` má nově vracet **403**, a request
bez hlaviček musí vracet **403** dál (kdyby vrátil 200, mitigace rozbila rozpoznání IP
a je potřeba ji okamžitě vrátit).

### Jak se IP dostane přes proxy `/s/` — a proč to je jinak, než říká dokumentace

Vercel dokumentuje, že `x-forwarded-for` i `x-real-ip` **přepisuje** a externí IP
nepředává. Z toho by plynulo, že přes rewrite `/s/api/send → <umami>/api/send` uvidí Umami
IP originu hlavního webu a všechny klientské session se slijí do jedné.

**Měření to vyvrací.** Beacon přes proxy vrací `403` s tělem
`{"error":{"message":"Forbidden","code":"forbidden","status":403}}` — což je formát
odpovědi Umami a `forbidden()` je v `src/app/api/send/route.ts:147` **jediné** místo,
které ho vrací. Umami tedy moji skutečnou IP vidí.

Vysvětlení: Next.js rewrite předává hlavičky příchozího requestu dál **beze změny**
(ověřeno tím, že přes proxy prošel i podvržený `true-client-ip`), a Vercel na cílovém
deploymentu je nepřepisuje. Umami tak čte hlavičky, které nastavil edge **hlavního webu**
— tedy s IP návštěvníka.

Praktický důsledek: **věrohodná geografie v dashboardu není důkaz, že přeposílání IP
funguje.** `getLocation` se vrací na první provider hlavičce (`cf-ipcountry`
před `x-vercel-ip-country`, `src/lib/detect.ts:24-33`) nezávisle na tom, jakou IP se
hashuje session. Kontrolní metrika je **poměr sessions k pageviews**, ne mapa.

---

## Geolokace

| Proměnná | Poznámka |
|---|---|
| `BUILD_GEO` | **Nastavit na `1`, jakmile se začne posílat `payload.ip`.** |

`scripts/build-geo.js:17`: *„Vercel environment detected. Skipping geo setup."* — na Vercelu
se GeoLite2 **nestahuje**, pokud `BUILD_GEO` není nastavené.

Dokud tracker běží jen v prohlížeči, nevadí to: `payload.ip` se neposílá, takže
`getLocation` čte geo z Vercel hlaviček (`x-vercel-ip-country` a spol.) a k databázi se
nikdy nedostane.

Jakmile ale serverová vrstva pošle `payload.ip`, `getLocation` dostane `skipHeaders: true`,
hlavičky přeskočí a spadne na databázový lookup. **Bez `BUILD_GEO` tam žádná databáze není.**

Do commitu `57f733070` v tomhle repu to znamenalo **HTTP 500 na každou takovou událost**
(a protože se reader cachuje v `globalThis`, i na všechny další). Ověřeno na živé instanci.
Oprava v `src/lib/detect.ts` z toho udělala degradaci místo výpadku — chybějící databáze
se jednou zaloguje a událost se uloží bez geolokace.

**Takže:** `BUILD_GEO=1` je pro server-side měření potřeba, aby geolokace vůbec vznikla,
ale už není potřeba k tomu, aby to nespadlo. GeoLite2-City je 32 MB komprimovaně —
při zapínání ověřit velikost build artefaktu proti limitu Vercel funkce.

Alternativy, které **nefungují**:

- Přeposílat Vercel geo hlavičky ze serverové vrstvy — Vercel je na příchozím requestu
  přepíše podle IP **našeho serveru**, takže by všechno bylo z Frankfurtu.
- `x-umami-client-country` / `-region` / `-city` — `src/lib/detect.ts:14` je čte
  **jen v `CLOUD_MODE`**, což self-hosted instance nemá.

---

## Ostatní

| Proměnná | Poznámka |
|---|---|
| `SALT_ROTATION` | Výchozí `month`. Ovlivňuje `sessionId = uuid(sourceId, ip, userAgent, salt)`. Změna rozseká historické session. |
| `DISABLE_BOT_CHECK` | **Nenastavovat.** Vypnulo by `isbot()` filtr v `route.ts:142`. |
| `REMOVE_TRAILING_SLASH` | Volitelné. Root `/` se nikdy nestripuje. |
| `SKIP_DB_CHECK` | Jen pro build bez živé databáze (CI). Ne v produkci. |
| `CLICKHOUSE_URL`, `KAFKA_URL`, `REDIS_URL` | Nenastavené — instance běží relational-only. |

Veřejný stav instance se dá kdykoli ověřit bez přihlášení:

```bash
curl -s https://analytics.vzdelanibudoucnosti.cz/api/heartbeat
curl -s https://analytics.vzdelanibudoucnosti.cz/api/config
```

`/api/config` k 2026-09-09 vrací:
`{"cloudMode":false,"privateMode":false,"sessionDeletionEnabled":true,"telemetryDisabled":true,"trackerScriptName":"stats.js","updatesDisabled":false}`

---

## Jak bezpečně sondovat produkci

Při ladění měření je potřeba rozlišit „endpoint nefunguje" od „moje IP je blokovaná".
Použij `type:"identify"` **bez `id` a bez `data`** — projde autentizací webu, detekcí
klienta, bot filtrem i `IGNORE_IP`, ale **nic nezapíše** (`src/app/api/send/route.ts:308-344`
obě větve přeskočí).

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://analytics.vzdelanibudoucnosti.cz/api/send \
  -H 'content-type: application/json' \
  -H 'user-agent: Mozilla/5.0 …' \
  -d '{"type":"identify","payload":{"website":"<websiteId>"}}'
```

| Kód | Význam |
|---|---|
| `200` | endpoint i websiteId v pořádku, IP není blokovaná |
| `403` | `IGNORE_IP` — z téhle sítě se nic nezapíše, **není to chyba** |
| `400` | websiteId neexistuje, nebo je payload špatně |
| `500` | serverová chyba — např. chybějící geo databáze u `payload.ip` (viz výše) |

`websiteId` je veřejná hodnota, dá se přečíst z HTML nebo JS bundlu měřeného webu.
