import type { AnalyticsConfig, EventProps } from './types';
/** Name of the global the tracker looks up for `data-before-send`. */
export declare const BEFORE_SEND_CALLBACK = "__umamiBeforeSend";
export interface ClientAnalytics {
    /** Attribute value for `data-before-send`. The tracker resolves it by name at send time. */
    beforeSendCallbackName: string;
    /** Install the before-send guard on window. Must run before the tracker script is inserted. */
    installBeforeSend: () => void;
    trackPageview: (url: string) => void;
    trackEvent: (name: string, props?: EventProps) => void;
    /** Call from the tracker's onReady. Without it the queue never drains. */
    flushQueue: () => void;
    isTracked: (hostname: string) => boolean;
    /** Test helper: empties the queue and forgets the last URL. */
    reset: () => void;
}
/**
 * The tracker is inserted with strategy afterInteractive, so window.umami does not exist
 * for a moment after hydration. Events that fire on page load fall into that gap and
 * window.umami?.track() drops them silently. Measured on the main site: of 46 direct
 * arrivals at the registration form, not one produced an event; of 22 arrivals by click,
 * where the script was already loaded from the previous page, 10 did.
 *
 * Pageviews are queued for the same reason. Sending them from onReady instead would use
 * the URL at script-load time, so anyone who clicked through in the meantime had the wrong
 * entry page recorded — against Vercel over the same window, "/" was short by 15 visitors
 * while the course listing had 6 too many.
 *
 * One array holds both so ordering survives: an event is never sent before the pageview
 * of the page it happened on.
 */
export declare function createClientAnalytics(config: AnalyticsConfig): ClientAnalytics;
