import type { AnalyticsConfig, EventProps, SanitizedProps } from './types';

const DEFAULT_MAX_PROP_LENGTH = 200;
const DEFAULT_MAX_REVENUE = 1_000_000;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

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
 * Returns null for a page that must not be measured, so the caller sends nothing at all
 * rather than sending a redacted version of it.
 */
export function toTrackedUrl(config: AnalyticsConfig, url: string): string | null {
  const [path, search] = toPathAndQuery(url).split('?');

  if (config.blockedPathPrefixes.some(prefix => path.startsWith(prefix))) {
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
 * Whitelist, not blocklist. Revenue is the single exception: Umami fills its revenue
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

    if (typeof value === 'string' && value.trim() !== '') {
      sanitized[key] = value.trim().slice(0, maxLength);
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
