/**
 * Everything that differs between sites is configuration. Nothing in this package
 * hardcodes a hostname, a path or a query key — that is the whole point of it existing.
 */
export interface AnalyticsConfig {
    /** Umami website id. Public value, it appears in the page source. */
    websiteId?: string;
    /**
     * Production hostnames, including every `www.` variant and old domain.
     * Measurement is switched off on anything else, which is what keeps preview
     * deployments and localhost out of the data.
     */
    trackedHosts: string[];
    /**
     * Collapse the identifying segment of a path into a placeholder, e.g.
     * `/hry/cyber-duel/play/AB12` into `/hry/cyber-duel/play/:pin`. Runs before the
     * blocklist below, so a prefix there is matched against the normalised path.
     *
     * This is not a weaker `blockedPathPrefixes` but the answer to a different question.
     * A path whose secret nobody needs measured is blocked. A path where the page holding
     * the secret *is* the funnel — a game lobby that is joined by PIN — cannot be, or the
     * whole flow goes unmeasured; normalising keeps the aggregate and drops the secret.
     */
    normalizePath?: (path: string) => string;
    /**
     * Path prefixes that must never be measured. This is a blocklist on top of the
     * query whitelist below, for paths that carry a secret in the path itself —
     * access tokens, game PINs, admin.
     */
    blockedPathPrefixes: string[];
    /**
     * Query keys allowed to leave the browser. A **whitelist, not a blocklist**:
     * anything not listed here is dropped. Keep the UTM parameters and click ids,
     * or campaign attribution disappears.
     */
    allowedQueryKeys: string[];
    /** Event property keys allowed to leave. Same whitelist rule as the query keys. */
    allowedPropKeys: string[];
    /**
     * Numeric event property keys allowed to leave. Held apart from `allowedPropKeys`
     * rather than folded into it because the type decides how Umami stores the value:
     * a number is a figure it can average, a string is only a label.
     */
    allowedNumberPropKeys?: string[];
    /** Cap on a single property value, to keep one bad caller from shipping a document. */
    maxPropLength?: number;
    /** Upper bound for `revenue`, as a sanity check against a misplaced decimal point. */
    maxRevenue?: number;
    /** How many items to hold while the tracker loads. */
    maxQueuedItems?: number;
}
/**
 * Deliberately has no index signature. TypeScript does not give interfaces an implicit
 * one, so requiring it here would reject every ordinary `interface` a site declares for
 * its own events — which is exactly what callers pass. Arbitrary keys are read through a
 * cast inside toEventProps instead, and the whitelist decides what survives anyway.
 */
export interface EventProps {
    /** Amount in the currency below. Sent only together with `currency`. */
    revenue?: number;
    /** ISO 4217 code. Umami ignores revenue without it. */
    currency?: string;
}
export type SanitizedProps = Record<string, string | number>;
export interface QueuedPageview {
    kind: 'pageview';
    /**
     * The URL as it was when the item was created. Taking it at send time instead
     * would attach the item to whatever page the visitor moved on to.
     */
    url: string;
}
export interface QueuedEvent {
    kind: 'event';
    url: string;
    name: string;
    props?: EventProps;
}
export type QueuedItem = QueuedPageview | QueuedEvent;
export interface UmamiTracker {
    track: {
        (payloadBuilder: (props: Record<string, unknown>) => Record<string, unknown>): void;
        (eventName: string, eventData?: Record<string, string>): void;
    };
}
declare global {
    interface Window {
        umami?: UmamiTracker;
    }
}
