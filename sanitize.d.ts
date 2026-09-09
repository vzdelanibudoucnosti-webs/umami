import type { AnalyticsConfig, EventProps, SanitizedProps } from './types';
/**
 * Reduce an absolute URL to path + query.
 *
 * The blocklist below matches prefixes against the start of the string, so
 * `https://host/online/token` would not match `/online/` at all. Server-side callers
 * get the URL from a `referer` header, which is always absolute, so this is not
 * a theoretical case.
 */
export declare function toPathAndQuery(raw: string): string;
/**
 * Returns null for a page that must not be measured, so the caller sends nothing at all
 * rather than sending a redacted version of it.
 */
export declare function toTrackedUrl(config: AnalyticsConfig, url: string): string | null;
/** The referrer is the second way a token or an e-mail gets out. Only the origin survives. */
export declare function toTrackedReferrer(referrer: unknown): string;
/**
 * Whitelist, not blocklist. Revenue is the single exception: Umami fills its revenue
 * table from `revenue` + `currency`, and without them it can only count conversions,
 * not report on them. Because every widening of the whitelist weakens the guard against
 * leaking personal data, the pair is held to hard rules — a finite positive amount in a
 * sane range, and a currency of exactly three capitals. They are sent only together;
 * a currency on its own says nothing and a free-form string would be exactly the hole
 * the whitelist exists to close.
 */
export declare function toEventProps(config: AnalyticsConfig, props?: EventProps): SanitizedProps;
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
export declare function sanitizeBeacon<T extends Record<string, unknown>>(config: AnalyticsConfig, payload: T): T | null;
/** Trailing-dot FQDNs are the same host, and a port must not defeat the comparison. */
export declare function isTrackedHost(config: AnalyticsConfig, hostname: string): boolean;
