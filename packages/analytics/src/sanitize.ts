import type { AnalyticsConfig, EventProps, SanitizedProps } from './types';

const DEFAULT_MAX_PROP_LENGTH = 200;
const DEFAULT_MAX_REVENUE = 1_000_000;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Owned by the revenue block in toEventProps, which holds them to rules a plain
 * whitelist entry would skip: sent only as a pair, capped, rounded to cents. Listing
 * either key in allowedPropKeys or allowedNumberPropKeys must not become a way around
 * that — and listing `revenue` as an ordinary number is the obvious thing to try.
 */
const RESERVED_PROP_KEYS = new Set(['revenue', 'currency']);

/**
 * Reduce an absolute URL to path + query.
 *
 * The blocklist below matches prefixes against the start of the string, so
 * `https://host/online/token` would not match `/online/` at all. Server-side callers
 * get the URL from a `referer` header, which is always absolute, so this is not
 * a theoretical case.
 */
export function toPathAndQuery(raw: string): string {
  try {
    const parsed = new URL(raw, 'https://placeholder.invalid');

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

/**
 * The site's own `normalizePath`, run inside the guard the rest of this module is.
 *
 * Only the path may be rewritten. A `?` in the result would carry a raw query straight
 * past `allowedQueryKeys` — the one thing this file exists to prevent — and a normaliser
 * accidentally written over the whole URL rather than the path is an easy way to get one.
 *
 * A throw fails closed, and returns null rather than the raw path: the raw path is
 * exactly the address the callback was configured to redact. Letting it escape instead is
 * not an option either, because config is foreign code on the hot path of every pageview,
 * every event and every beacon, and measurement must not break the page.
 */
function applyNormalizePath(config: AnalyticsConfig, path: string): string | null {
  if (!config.normalizePath) {
    return path;
  }

  try {
    return config.normalizePath(path).split('?')[0];
  } catch (e) {
    console.error(e);

    return null;
  }
}

/**
 * Returns null for a page that must not be measured, so the caller sends nothing at all
 * rather than sending a redacted version of it.
 */
export function toTrackedUrl(config: AnalyticsConfig, url: string): string | null {
  const [rawPath, search] = toPathAndQuery(url).split('?');
  // Before the blocklist, so a blocked prefix is matched against the normalised path
  // and a site cannot end up with two spellings of the same rule.
  const path = applyNormalizePath(config, rawPath);

  if (path === null || config.blockedPathPrefixes.some(prefix => path.startsWith(prefix))) {
    return null;
  }

  if (!search) {
    return path;
  }

  const incoming = new URLSearchParams(search);
  const allowed = new URLSearchParams();

  for (const key of config.allowedQueryKeys) {
    const value = incoming.get(key);

    if (value) {
      allowed.set(key, value);
    }
  }

  const query = allowed.toString();

  return query ? `${path}?${query}` : path;
}

/** The referrer is the second way a token or an e-mail gets out. Only the origin survives. */
export function toTrackedReferrer(referrer: unknown): string {
  if (typeof referrer !== 'string' || referrer === '') {
    return '';
  }

  try {
    return new URL(referrer).origin;
  } catch {
    return '';
  }
}

/**
 * Whitelist, not blocklist, and the two lists are separated by type: a key in
 * `allowedPropKeys` survives only as a string, one in `allowedNumberPropKeys` only as a
 * finite number, and a key on both lists is taken either way. Revenue is the single
 * exception, and neither list can reach it: Umami fills its revenue
 * table from `revenue` + `currency`, and without them it can only count conversions,
 * not report on them. Because every widening of the whitelist weakens the guard against
 * leaking personal data, the pair is held to hard rules — a finite positive amount in a
 * sane range, and a currency of exactly three capitals. They are sent only together;
 * a currency on its own says nothing and a free-form string would be exactly the hole
 * the whitelist exists to close.
 */
export function toEventProps(config: AnalyticsConfig, props?: EventProps): SanitizedProps {
  const sanitized: SanitizedProps = {};

  if (!props) {
    return sanitized;
  }

  const maxLength = config.maxPropLength ?? DEFAULT_MAX_PROP_LENGTH;
  const record = props as Record<string, unknown>;

  for (const key of config.allowedPropKeys) {
    const value = record[key];

    if (RESERVED_PROP_KEYS.has(key)) {
      continue;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      sanitized[key] = value.trim().slice(0, maxLength);
    }
  }

  for (const key of config.allowedNumberPropKeys ?? []) {
    const value = record[key];

    if (RESERVED_PROP_KEYS.has(key)) {
      continue;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
    }
  }

  const { revenue, currency } = props;
  const maxRevenue = config.maxRevenue ?? DEFAULT_MAX_REVENUE;
  const hasRevenue =
    typeof revenue === 'number' && Number.isFinite(revenue) && revenue > 0 && revenue <= maxRevenue;
  const hasCurrency = typeof currency === 'string' && CURRENCY_PATTERN.test(currency);

  if (hasRevenue && hasCurrency) {
    // Rounded to cents: the column has four decimal places and floating point noise
    // put 1199.9999999999998 into the report.
    sanitized.revenue = Math.round(revenue * 100) / 100;
    sanitized.currency = currency;
  }

  return sanitized;
}

/**
 * Last guard on the way out, attached through `data-before-send`.
 *
 * Pageviews and custom events fill in their own URL through toTrackedUrl. The Core Web
 * Vitals beacon does not — the tracker builds that URL itself from window.location, so
 * it bypasses the whitelist entirely and would ship a live lesson access token into
 * url_path. Verified in the browser before data-performance was switched on.
 *
 * Applied to every beacon type, not just performance: for URLs that already went through
 * toTrackedUrl the pass is idempotent, and if automatic events from data-umami-event
 * attributes are ever added they fall under the same guard with no further change.
 */
export function sanitizeBeacon<T extends Record<string, unknown>>(
  config: AnalyticsConfig,
  payload: T,
): T | null {
  if (!payload || typeof payload.url !== 'string' || payload.url === '') {
    return payload;
  }

  const url = toTrackedUrl(config, payload.url);

  if (!url) {
    return null;
  }

  return { ...payload, url, referrer: toTrackedReferrer(payload.referrer) };
}

/** Trailing-dot FQDNs are the same host, and a port must not defeat the comparison. */
export function isTrackedHost(config: AnalyticsConfig, hostname: string): boolean {
  const normalized = hostname.replace(/\.$/, '').toLowerCase();

  return config.trackedHosts.some(host => host.replace(/\.$/, '').toLowerCase() === normalized);
}
