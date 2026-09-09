import { sanitizeBeacon, toEventProps, toTrackedReferrer, toTrackedUrl } from './sanitize';
import type { AnalyticsConfig, EventProps, QueuedItem } from './types';

const DEFAULT_MAX_QUEUED_ITEMS = 20;

/** Name of the global the tracker looks up for `data-before-send`. */
export const BEFORE_SEND_CALLBACK = '__umamiBeforeSend';

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
export function createClientAnalytics(config: AnalyticsConfig): ClientAnalytics {
  const maxQueued = config.maxQueuedItems ?? DEFAULT_MAX_QUEUED_ITEMS;

  let queued: QueuedItem[] = [];
  let lastPageviewUrl: string | null = null;
  let activationListenerAttached = false;

  /**
   * A prerendered page runs its scripts and reaches readyState 'complete' even though the
   * visitor may never open it, and Chrome prerenders from the omnibox on its own, with no
   * opt-in from the site. The tracker guards its own auto-pageview, but a site that sends
   * pageviews by hand reaches window.umami.track() directly, so it needs this guard too.
   *
   * Prerendering is therefore treated exactly like "the tracker has not loaded yet":
   * queue, and flush on activation. A discarded prerender never fires the event, so
   * nothing is ever sent.
   */
  const isPrerendering = (): boolean =>
    typeof document !== 'undefined' &&
    (document as Document & { prerendering?: boolean }).prerendering === true;

  const flushOnActivation = (): void => {
    if (activationListenerAttached || typeof document === 'undefined') {
      return;
    }

    activationListenerAttached = true;
    document.addEventListener('prerenderingchange', () => flushQueue(), { once: true });
  };

  const enqueue = (item: QueuedItem): void => {
    // The cap guards against a page that fires forever without the tracker ever arriving.
    if (queued.length < maxQueued) {
      queued.push(item);
    }

    if (isPrerendering()) {
      flushOnActivation();
    }
  };

  /**
   * Umami's track() takes two shapes. The string one fills in URL and referrer from its
   * own state, which holds the raw location — including a parent's e-mail in ?e= or a
   * lesson token in the referrer. That bypasses the whitelist, so everything here uses
   * the functional shape and supplies both fields itself.
   */
  const sendPageview = (url: string): void => {
    try {
      window.umami?.track(payload => ({
        ...payload,
        url,
        referrer: toTrackedReferrer(payload.referrer),
      }));
    } catch (e) {
      console.error(e);
    }
  };

  const sendEvent = (name: string, props: EventProps | undefined, url: string): void => {
    try {
      window.umami?.track(payload => ({
        ...payload,
        url,
        referrer: toTrackedReferrer(payload.referrer),
        name,
        data: toEventProps(config, props),
      }));
    } catch (e) {
      console.error(e);
    }
  };

  function flushQueue(): void {
    if (typeof window === 'undefined' || !window.umami || queued.length === 0) {
      return;
    }

    // The tracker's onReady arrives during a prerender as well. Nothing may be sent
    // until the visitor actually opens the page.
    if (isPrerendering()) {
      flushOnActivation();
      return;
    }

    const batch = queued;
    queued = [];

    for (const item of batch) {
      if (item.kind === 'pageview') {
        sendPageview(item.url);
      } else {
        sendEvent(item.name, item.props, item.url);
      }
    }
  }

  return {
    beforeSendCallbackName: BEFORE_SEND_CALLBACK,

    installBeforeSend: () => {
      if (typeof window === 'undefined') {
        return;
      }

      (window as unknown as Record<string, unknown>)[BEFORE_SEND_CALLBACK] = (
        _type: string,
        payload: Record<string, unknown>,
      ) => sanitizeBeacon(config, payload);
    },

    trackPageview: (url: string) => {
      if (typeof window === 'undefined') {
        return;
      }

      const trackedUrl = toTrackedUrl(config, url);

      // Listing filters only change the query, and the query is stripped, so
      // a route change arrives with a URL identical to the previous one after
      // normalisation. Without this memory every filter click would send a second
      // pageview for the same page. Only the adjacent URL is compared, so A -> B -> A
      // is a real visit and is still sent.
      if (!trackedUrl || trackedUrl === lastPageviewUrl) {
        return;
      }

      lastPageviewUrl = trackedUrl;

      if (!window.umami || isPrerendering()) {
        enqueue({ kind: 'pageview', url: trackedUrl });
        return;
      }

      sendPageview(trackedUrl);
    },

    trackEvent: (name: string, props?: EventProps) => {
      if (typeof window === 'undefined') {
        return;
      }

      const url = toTrackedUrl(config, `${window.location.pathname}${window.location.search}`);

      // On a page that must not be measured the event does not exist at all —
      // it is not even queued.
      if (!url) {
        return;
      }

      if (!window.umami || isPrerendering()) {
        enqueue({ kind: 'event', name, props, url });
        return;
      }

      sendEvent(name, props, url);
    },

    flushQueue,

    isTracked: (hostname: string) => {
      const normalized = hostname.replace(/\.$/, '').toLowerCase();

      return config.trackedHosts.some(
        host => host.replace(/\.$/, '').toLowerCase() === normalized,
      );
    },

    reset: () => {
      queued = [];
      lastPageviewUrl = null;
      activationListenerAttached = false;
    },
  };
}
