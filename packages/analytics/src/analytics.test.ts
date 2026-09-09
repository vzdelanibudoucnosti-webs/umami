import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClientAnalytics } from './client';
import { sanitizeBeacon, toEventProps, toTrackedReferrer, toTrackedUrl } from './sanitize';
import { createServerAnalytics } from './server';
import type { AnalyticsConfig, EventProps } from './types';

/**
 * What a site declares for its own events: an ordinary interface extending EventProps.
 * That it assigns cleanly is the point — EventProps deliberately has no index signature,
 * because TypeScript would then reject exactly this shape.
 */
interface SiteProps extends EventProps {
  course_slug?: string;
  school?: string;
}

const config: AnalyticsConfig = {
  websiteId: '01b034e5-4269-4f10-86fc-4b747c710c0d',
  trackedHosts: ['example.cz', 'www.example.cz'],
  blockedPathPrefixes: ['/online/', '/dotaznik/', '/admin', '/api/'],
  allowedQueryKeys: ['utm_source', 'utm_medium', 'gclid'],
  allowedPropKeys: ['course_slug', 'school'],
};

type PayloadBuilder = (props: Record<string, unknown>) => Record<string, unknown>;

const built = (call: unknown[], props: Record<string, unknown> = { url: '/raw?e=a@b.cz', referrer: '' }) =>
  (call[0] as PayloadBuilder)(props);

describe('toTrackedUrl', () => {
  test('drops every query key outside the whitelist', () => {
    expect(toTrackedUrl(config, '/kurzy?utm_source=meta&e=parent@example.com')).toBe(
      '/kurzy?utm_source=meta',
    );
  });

  test('returns null for a blocked path, so nothing is sent at all', () => {
    expect(toTrackedUrl(config, '/online/77bbcbe9953f4960')).toBeNull();
  });

  // Prefixes are matched against the start of the string, so an absolute URL has to be
  // reduced first or the blocklist never matches.
  test('matches the blocklist on an absolute url too', () => {
    expect(toTrackedUrl(config, 'https://example.cz/admin/users')).toBeNull();
  });

  test('keeps a path with no query untouched', () => {
    expect(toTrackedUrl(config, '/kurzy')).toBe('/kurzy');
  });
});

describe('toEventProps', () => {
  test('keeps only whitelisted keys, so no personal data reaches Umami', () => {
    expect(toEventProps(config, { course_slug: 'python', email: 'a@b.cz' } as SiteProps)).toEqual({
      course_slug: 'python',
    });
  });

  test('sends revenue and currency only together', () => {
    expect(toEventProps(config, { revenue: 1200 })).toEqual({});
    expect(toEventProps(config, { currency: 'CZK' })).toEqual({});
    expect(toEventProps(config, { revenue: 1200, currency: 'CZK' })).toEqual({
      revenue: 1200,
      currency: 'CZK',
    });
  });

  test('rounds away floating point noise', () => {
    expect(toEventProps(config, { revenue: 1199.9999999999998, currency: 'CZK' }).revenue).toBe(1200);
  });

  test('rejects a currency that is not three capitals', () => {
    expect(toEventProps(config, { revenue: 100, currency: 'czk' })).toEqual({});
  });
});

describe('toTrackedReferrer', () => {
  test('reduces a referrer to its origin, so a token in the path cannot leak', () => {
    expect(toTrackedReferrer('https://example.cz/online/token?e=a@b.cz')).toBe('https://example.cz');
  });

  test('returns an empty string for anything unparseable', () => {
    expect(toTrackedReferrer(undefined)).toBe('');
  });
});

describe('sanitizeBeacon', () => {
  // The Core Web Vitals beacon builds its own URL from window.location, so it bypasses
  // toTrackedUrl entirely. This is the guard that catches it.
  test('drops a beacon from a page that must not be measured', () => {
    expect(sanitizeBeacon(config, { url: 'https://example.cz/online/token' })).toBeNull();
  });

  test('is idempotent for a url that already passed toTrackedUrl', () => {
    expect(sanitizeBeacon(config, { url: '/kurzy?utm_source=meta', referrer: '' })).toEqual({
      url: '/kurzy?utm_source=meta',
      referrer: '',
    });
  });
});

/**
 * A site whose funnel runs through addresses that carry a live join code: the page has to
 * be measured, the code must not be stored. Blocking the path would leave the whole play
 * flow unmeasured, so it is normalised instead.
 */
const gamesConfig: AnalyticsConfig = {
  ...config,
  blockedPathPrefixes: ['/api/'],
  allowedPropKeys: ['game_slug'],
  allowedNumberPropKeys: ['score', 'rounds'],
  normalizePath: path => path.replace(/^(\/hry\/[^/]+\/(?:lobby|play|result))\/[^/]+/, '$1/:pin'),
};

describe('normalizePath', () => {
  test('collapses the identifying segment but keeps the page and the campaign', () => {
    expect(toTrackedUrl(gamesConfig, '/hry/cyber-duel/play/AB12?utm_source=meta&pin=AB12')).toBe(
      '/hry/cyber-duel/play/:pin?utm_source=meta',
    );
  });

  test('leaves a path it does not match alone', () => {
    expect(toTrackedUrl(gamesConfig, '/hry/cyber-duel/solo')).toBe('/hry/cyber-duel/solo');
  });

  // The blocklist is applied to the normalised path, so a site writes the rule in one
  // spelling instead of one per raw variant.
  test('runs before the blocklist', () => {
    const blocked: AnalyticsConfig = {
      ...gamesConfig,
      blockedPathPrefixes: ['/hry/cyber-duel/play/:pin'],
    };

    expect(toTrackedUrl(blocked, '/hry/cyber-duel/play/AB12')).toBeNull();
  });

  // The whole reason data-performance needs data-before-send: the beacon's URL is built
  // by the tracker from window.location and would carry the live PIN.
  test('reaches the Core Web Vitals beacon as well', () => {
    expect(
      sanitizeBeacon(gamesConfig, {
        url: 'https://hry.example.cz/hry/cyber-duel/play/AB12',
        referrer: 'https://hry.example.cz/trida/CD-42',
      }),
    ).toEqual({ url: '/hry/cyber-duel/play/:pin', referrer: 'https://hry.example.cz' });
  });

  // The callback is handed the path alone, so a query cannot be reached through it.
  // A normaliser written over the whole URL by mistake must not become a way past
  // allowedQueryKeys — the one guard the query has.
  test('never lets the callback reach the query', () => {
    const smuggling: AnalyticsConfig = {
      ...gamesConfig,
      normalizePath: path => `${path}?e=parent@example.com`,
    };

    expect(toTrackedUrl(smuggling, '/kurzy')).toBe('/kurzy');
    expect(toTrackedUrl(smuggling, '/kurzy?utm_source=meta')).toBe('/kurzy?utm_source=meta');
  });

  // Config is foreign code on the hot path of every pageview, event and beacon. It fails
  // closed rather than falling back to the raw path, which is the very address the
  // callback was configured to redact.
  test('sends nothing at all when the callback throws, and does not break the caller', () => {
    const broken: AnalyticsConfig = {
      ...gamesConfig,
      normalizePath: path => path.split('/')[9].toUpperCase(),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(toTrackedUrl(broken, '/hry/cyber-duel/play/AB12')).toBeNull();

    const analytics = createClientAnalytics(broken);
    const track = vi.fn();
    window.umami = { track } as never;

    expect(() => analytics.trackPageview('/hry/cyber-duel/play/AB12')).not.toThrow();
    expect(track).not.toHaveBeenCalled();

    window.umami = undefined;
    vi.restoreAllMocks();
  });

  test('reaches an event, which reads its address off window.location', () => {
    const analytics = createClientAnalytics(gamesConfig);
    const track = vi.fn();

    window.history.pushState({}, '', '/hry/cyber-duel/play/AB12');
    window.umami = { track } as never;
    analytics.trackEvent('round_finished');

    expect(built(track.mock.calls[0])).toMatchObject({ url: '/hry/cyber-duel/play/:pin' });

    window.umami = undefined;
    window.history.pushState({}, '', '/');
  });
});

describe('allowedNumberPropKeys', () => {
  test('keeps a whitelisted number as a number, so Umami can report on it', () => {
    expect(toEventProps(gamesConfig, { score: 7, rounds: 10 } as EventProps)).toEqual({
      score: 7,
      rounds: 10,
    });
  });

  test('drops a value that is not a finite number', () => {
    expect(
      toEventProps(gamesConfig, { score: Number.NaN, rounds: '10' } as unknown as EventProps),
    ).toEqual({});
  });

  test('still drops a number whose key is on neither list', () => {
    expect(toEventProps(gamesConfig, { pin: 1234 } as unknown as EventProps)).toEqual({});
  });

  test('takes a key on both lists either way', () => {
    const both: AnalyticsConfig = {
      ...gamesConfig,
      allowedPropKeys: ['result'],
      allowedNumberPropKeys: ['result'],
    };

    expect(toEventProps(both, { result: 'win' } as unknown as EventProps)).toEqual({
      result: 'win',
    });
    expect(toEventProps(both, { result: 3 } as unknown as EventProps)).toEqual({ result: 3 });
  });

  // Revenue is held to rules a plain whitelist entry would skip — the pair, the ceiling,
  // the rounding — so neither list may reach it. Listing it as an ordinary number is the
  // obvious thing to try, and it used to work.
  test('cannot be used to smuggle revenue past its own rules', () => {
    const greedy: AnalyticsConfig = {
      ...gamesConfig,
      allowedPropKeys: ['currency'],
      allowedNumberPropKeys: ['revenue'],
    };

    expect(toEventProps(greedy, { revenue: 999_999_999.987 } as EventProps)).toEqual({});
    expect(toEventProps(greedy, { currency: 'czk' } as EventProps)).toEqual({});
    expect(toEventProps(greedy, { revenue: 1199.9999999999998, currency: 'CZK' })).toEqual({
      revenue: 1200,
      currency: 'CZK',
    });
  });
});

describe('client', () => {
  let analytics: ReturnType<typeof createClientAnalytics>;

  beforeEach(() => {
    analytics = createClientAnalytics(config);
    window.umami = undefined;
    window.history.pushState({}, '', '/');
  });

  test('holds an event fired before the tracker loaded and sends it once it does', () => {
    analytics.trackEvent('registration_submit', { course_slug: 'python' } as SiteProps);

    const track = vi.fn();
    window.umami = { track } as never;
    analytics.flushQueue();

    expect(built(track.mock.calls[0])).toMatchObject({
      name: 'registration_submit',
      data: { course_slug: 'python' },
    });
  });

  test('keeps the order in which early items were created', () => {
    analytics.trackPageview('/kurzy');
    analytics.trackEvent('registration_submit', { course_slug: 'a' } as SiteProps);

    const track = vi.fn();
    window.umami = { track } as never;
    analytics.flushQueue();

    expect(track.mock.calls.map(c => built(c).name)).toEqual([undefined, 'registration_submit']);
  });

  test('drains the queue, so a second flush sends nothing again', () => {
    analytics.trackPageview('/kurzy');

    const track = vi.fn();
    window.umami = { track } as never;
    analytics.flushQueue();
    analytics.flushQueue();

    expect(track).toHaveBeenCalledTimes(1);
  });

  test('stops queueing so a page cannot grow the queue forever', () => {
    for (let i = 0; i < 50; i += 1) {
      analytics.trackEvent('e', { course_slug: `c${i}` } as SiteProps);
    }

    const track = vi.fn();
    window.umami = { track } as never;
    analytics.flushQueue();

    expect(track).toHaveBeenCalledTimes(20);
  });

  test('keeps the url from when the item was created, not from when the queue drained', () => {
    window.history.pushState({}, '', '/registrace/python?utm_source=cta');
    analytics.trackEvent('registration_submit', { course_slug: 'python' } as SiteProps);

    window.history.pushState({}, '', '/dekujeme');
    const track = vi.fn();
    window.umami = { track } as never;
    analytics.flushQueue();

    expect(built(track.mock.calls[0]).url).toBe('/registrace/python?utm_source=cta');
  });

  // Listing filters only change the query, which is stripped, so the route change
  // arrives with a URL identical to the previous one.
  test('does not send the same pageview twice in a row', () => {
    const track = vi.fn();
    window.umami = { track } as never;

    analytics.trackPageview('/kurzy?vek=9-12');
    analytics.trackPageview('/kurzy?vek=13-15');

    expect(track).toHaveBeenCalledTimes(1);
  });

  test('still counts a real return to a page', () => {
    const track = vi.fn();
    window.umami = { track } as never;

    analytics.trackPageview('/a');
    analytics.trackPageview('/b');
    analytics.trackPageview('/a');

    expect(track).toHaveBeenCalledTimes(3);
  });

  test('sends nothing at all from a page that must not be measured', () => {
    const track = vi.fn();
    window.umami = { track } as never;

    analytics.trackPageview('/online/77bbcbe9953f4960');

    expect(track).not.toHaveBeenCalled();
  });

  test('measurement is limited to the configured hosts', () => {
    expect(analytics.isTracked('www.example.cz')).toBe(true);
    expect(analytics.isTracked('example.cz.')).toBe(true);
    expect(analytics.isTracked('example-git-preview.vercel.app')).toBe(false);
  });
});

describe('client prerender', () => {
  let analytics: ReturnType<typeof createClientAnalytics>;

  const setPrerendering = (value: boolean) => {
    Object.defineProperty(document, 'prerendering', { configurable: true, value });
  };

  const activate = () => {
    setPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));
  };

  beforeEach(() => {
    analytics = createClientAnalytics(config);
    window.umami = undefined;
    window.history.pushState({}, '', '/');
  });

  afterEach(() => setPrerendering(false));

  test('queues instead of sending while the page is being prerendered', () => {
    const track = vi.fn();
    window.umami = { track } as never;
    setPrerendering(true);

    analytics.trackPageview('/kurzy');

    expect(track).not.toHaveBeenCalled();
  });

  test('sends nothing when the prerender is discarded', () => {
    const track = vi.fn();
    window.umami = { track } as never;
    setPrerendering(true);

    analytics.trackPageview('/kurzy');
    // No activation: prerenderingchange never fires.

    expect(track).not.toHaveBeenCalled();
  });

  test('sends on activation with the url captured during the prerender', () => {
    const track = vi.fn();
    window.umami = { track } as never;
    setPrerendering(true);

    analytics.trackPageview('/kurzy');
    activate();

    expect(built(track.mock.calls[0]).url).toBe('/kurzy');
  });

  // The tracker's onReady arrives during a prerender too and must not drain the queue.
  test('holds the queue when the tracker reports ready during a prerender', () => {
    setPrerendering(true);
    analytics.trackPageview('/kurzy');

    const track = vi.fn();
    window.umami = { track } as never;
    analytics.flushQueue();

    expect(track).not.toHaveBeenCalled();

    activate();

    expect(built(track.mock.calls[0]).url).toBe('/kurzy');
  });
});

describe('server', () => {
  const HOST = 'https://analytics.example.cz';
  let fetchMock: ReturnType<typeof vi.fn>;
  let server: ReturnType<typeof createServerAnalytics>;

  const input = {
    name: 'registration_submit',
    url: '/registrace/python',
    hostname: 'example.cz',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 Chrome/152',
  };

  const sentBody = () => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server = createServerAnalytics(config, { hostUrl: HOST });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('is inert without a host url', async () => {
    await createServerAnalytics(config, {}).sendEvent(input);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Session is uuid(websiteId, ip, userAgent, salt); without the pair the conversion
  // would invent a session instead of joining the visitor's.
  test('sends nothing without the visitor ip', async () => {
    await server.sendEvent({ ...input, ip: undefined });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sends nothing without the visitor user agent', async () => {
    await server.sendEvent({ ...input, userAgent: undefined });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('posts the event with the visitor ip and user agent', async () => {
    await server.sendEvent({ ...input, props: { course_slug: 'python' } as SiteProps });

    expect(fetchMock).toHaveBeenCalledWith(`${HOST}/api/send`, expect.objectContaining({ method: 'POST' }));
    expect(sentBody()).toMatchObject({
      type: 'event',
      payload: {
        website: config.websiteId,
        hostname: 'example.cz',
        url: '/registrace/python',
        name: 'registration_submit',
        data: { course_slug: 'python' },
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 Chrome/152',
      },
    });
  });

  test('applies the same query whitelist as the client', async () => {
    await server.sendEvent({ ...input, url: '/registrace/python?e=a@b.cz&utm_source=meta' });

    expect(sentBody().payload.url).toBe('/registrace/python?utm_source=meta');
  });

  test('reduces an absolute referer before matching the blocklist', async () => {
    await server.sendEvent({ ...input, url: 'https://example.cz/admin/registrace' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Both senders go through toTrackedUrl, so a site configures normalisation once
  // rather than once per sender.
  test('normalises the path the same way the client does', async () => {
    const games = createServerAnalytics(gamesConfig, { hostUrl: HOST });

    await games.sendEvent({ ...input, url: 'https://hry.example.cz/hry/cyber-duel/result/AB12' });

    expect(sentBody().payload.url).toBe('/hry/cyber-duel/result/:pin');
  });

  // Measurement must never break a conversion.
  test('does not throw when the instance is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(server.sendEvent(input)).resolves.toBeUndefined();
  });

  // IGNORE_IP rejecting internal traffic is expected, not a fault.
  test('stays quiet on a 403', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await server.sendEvent(input);

    expect(console.error).not.toHaveBeenCalled();
  });

  test('reports a real failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await server.sendEvent(input);

    expect(console.error).toHaveBeenCalled();
  });
});
