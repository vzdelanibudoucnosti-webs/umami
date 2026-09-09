import type { AnalyticsConfig, EventProps } from './types';
export interface ServerEventInput {
    name: string;
    props?: EventProps;
    /** Where the conversion happened. Server callers usually pass an absolute referer. */
    url: string;
    /** Hostname of the measured site. Umami fills its hostname column from it. */
    hostname: string;
    /**
     * The visitor's IP, not the server's. Umami hashes the session as
     * uuid(websiteId, ip, userAgent, salt), so the server's own IP would put the
     * conversion in a session of its own — or collapse every visitor into one.
     *
     * Do not take it from the left of x-forwarded-for: a client can forge that and
     * claim someone else's session. On Vercel, x-vercel-forwarded-for is set by the
     * platform and cannot be spoofed.
     */
    ip?: string;
    /** The visitor's User-Agent. It feeds the same hash as the IP. */
    userAgent?: string;
}
export interface ServerAnalyticsOptions {
    /** Base URL of the Umami instance. Without it the layer is inert. */
    hostUrl?: string;
    timeoutMs?: number;
}
export interface ServerAnalytics {
    sendEvent: (input: ServerEventInput) => Promise<void>;
}
/**
 * Server-side conversions.
 *
 * A browser event relies on the visitor staying on the page after submitting. For a paid
 * flow they leave for the payment gateway immediately, so the beacon races the redirect
 * and some conversions are lost. The server has no such race — the event is created where
 * the conversion is.
 *
 * Send it at the same moment as the other server-side conversion pixels, i.e. on
 * submission rather than after payment: registered revenue, not collected revenue, so
 * every report agrees.
 */
export declare function createServerAnalytics(config: AnalyticsConfig, options?: ServerAnalyticsOptions): ServerAnalytics;
