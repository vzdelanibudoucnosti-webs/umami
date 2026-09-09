# @vzb/analytics

The Umami measurement layer shared by the VZB sites. It lives here, next to the Umami
instance it talks to, so there is one copy of this logic instead of one per website.

Everything site-specific is configuration. The package hardcodes no hostname, no path
and no query key.

## Installing

npm and yarn cannot install a subdirectory of a git repository, so the package is
published to the **`analytics-dist` orphan branch**, which carries the build output with
`package.json` at its root. The repository is public, so consumers need no token:

```bash
yarn add "git+https://github.com/vzdelanibudoucnosti-webs/umami.git#analytics-dist"
```

Version with a tag or a commit when you need to pin one.

## Configuring

```ts
import { createClientAnalytics, createServerAnalytics, type AnalyticsConfig } from '@vzb/analytics'

const config: AnalyticsConfig = {
  websiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  trackedHosts: ['example.cz', 'www.example.cz'],
  blockedPathPrefixes: ['/online/', '/admin', '/api/'],
  allowedQueryKeys: ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'],
  allowedPropKeys: ['course_slug', 'school'],
  allowedNumberPropKeys: ['score'],
  normalizePath: path => path.replace(/^(\/hry\/[^/]+\/play)\/[^/]+/, '$1/:pin'),
}

export const analytics = createClientAnalytics(config)
export const serverAnalytics = createServerAnalytics(config, {
  hostUrl: process.env.UMAMI_HOST_URL,
})
```

Every whitelist is a **whitelist, not a blocklist**: a key that is not listed never leaves
the browser. Keep the UTM parameters and click ids in `allowedQueryKeys` or campaign
attribution disappears. `allowedPropKeys` and `allowedNumberPropKeys` are split by type
rather than merged, because the type is what decides how Umami stores the value — a number
is a figure it can average, a string is only a label.

`revenue` and `currency` are reserved and neither list can reach them; they are sent only
through the rules below.

`normalizePath` is for an address where the page is the funnel but a segment of it is a
secret: a game lobby joined by PIN, a share link. Blocking such a path leaves the flow
unmeasured, so the segment is collapsed into a placeholder instead. It runs before
`blockedPathPrefixes`, so a blocked prefix is matched against the normalised path, and it
applies to everything on the way out — pageviews, events, the Core Web Vitals beacon and
the server sender alike. It is handed the path alone and anything from a `?` on is cut off
the result, so it cannot be used to get a query past `allowedQueryKeys`; if it throws, the
payload is dropped rather than sent unnormalised.

## Client

```tsx
analytics.installBeforeSend()          // before the tracker script is inserted
analytics.trackPageview(url)
analytics.trackEvent('registration_submit', { course_slug: 'python' })
analytics.flushQueue()                 // from the tracker's onReady
analytics.isTracked(window.location.hostname)
```

Mount the tracker with `data-auto-pageview="false"` and send pageviews through
`trackPageview`, so the raw location never reaches Umami. `data-performance` requires
`data-before-send={analytics.beforeSendCallbackName}` — the Core Web Vitals beacon builds
its own URL and would otherwise walk straight past the whitelist.

## Server

```ts
serverAnalytics.sendEvent({
  name: 'registration_submit',
  props: { course_slug: 'python', revenue: 1200, currency: 'CZK' },
  url: req.headers.referer,
  hostname: 'example.cz',
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'],
}).catch(err => console.error(err))
```

Use it for conversions that are born on the backend. A browser event relies on the
visitor staying on the page; in a paid flow they leave for the gateway immediately and
the beacon races the redirect.

**Send the visitor's IP and User-Agent, never the server's.** Umami hashes the session as
`uuid(websiteId, ip, userAgent, salt)`, so the server's own IP would give the conversion
a session of its own. Do not read the IP from the left of `x-forwarded-for` — a client can
forge that and claim someone else's session; on Vercel use `x-vercel-forwarded-for`.

Never `await` it in a response path. It never throws, times out after 3s, and treats a
`403` as expected rather than an error, because that is `IGNORE_IP` rejecting internal
traffic.

## Things that are the way they are for a reason

- **The queue.** The tracker is inserted `afterInteractive`, so `window.umami` does not
  exist for a moment after hydration and events fired on load are dropped silently.
  Measured: of 46 direct arrivals at a registration form, not one produced an event.
- **The URL is captured when the item is created**, not when the queue drains, or the item
  attaches to whatever page the visitor moved on to.
- **Pageview dedupe** compares only the adjacent URL, so `A → B → A` still counts as three
  visits while a filter click that only changes a stripped query counts as one.
- **Prerender.** Chrome prerenders from the omnibox with no opt-in from the site, and a
  prerendered page runs scripts normally. Prerendering is treated like "the tracker has
  not loaded yet": queue, then flush on `prerenderingchange`. A discarded prerender sends
  nothing at all.
- **`sanitizeBeacon` is mandatory alongside `data-performance`.**

## Developing

```bash
pnpm test          # vitest
pnpm typecheck
pnpm build         # tsup for js, tsc for the declarations
pnpm publish-dist  # append the build to the analytics-dist branch
```

Declarations come from `tsc`, not tsup's dts worker, which resolves the repository root
tsconfig rather than this package's.
