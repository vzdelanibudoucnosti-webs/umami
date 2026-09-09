import { toEventProps, toTrackedUrl } from './sanitize';
import type { AnalyticsConfig, EventProps } from './types';

const DEFAULT_TIMEOUT_MS = 3000;

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
export function createServerAnalytics(
  config: AnalyticsConfig,
  options: ServerAnalyticsOptions = {},
): ServerAnalytics {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    /**
     * Never throws and never blocks the response — measurement must not break a
     * conversion. Call without await, with a .catch().
     */
    sendEvent: async ({ name, props, url, hostname, ip, userAgent }: ServerEventInput) => {
      const hostUrl = (options.hostUrl || '').replace(/\/+$/, '');

      // Without configuration the layer is inert, exactly like the client one, so
      // deploying the code does not wait on anything else.
      if (!hostUrl || !config.websiteId) {
        return;
      }

      // Without both values the conversion would not attach to the visitor's session
      // and would invent one instead. Better to send nothing than to corrupt sessions.
      if (!ip || !userAgent) {
        console.error('[vzb-analytics] missing client ip or user agent, event not sent:', name);
        return;
      }

      const trackedUrl = toTrackedUrl(config, url);

      if (!trackedUrl) {
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${hostUrl}/api/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'event',
            payload: {
              website: config.websiteId,
              hostname,
              url: trackedUrl,
              name,
              data: toEventProps(config, props),
              ip,
              userAgent,
            },
          }),
          signal: controller.signal,
        });

        // 403 is a legitimate state, not a failure: IGNORE_IP on the instance rejects
        // internal traffic.
        if (!response.ok && response.status !== 403) {
          console.error('[vzb-analytics] send failed:', response.status, name);
        }
      } catch (e) {
        console.error('[vzb-analytics] unexpected error:', e);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
