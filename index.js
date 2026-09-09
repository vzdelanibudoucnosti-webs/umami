// src/sanitize.ts
var DEFAULT_MAX_PROP_LENGTH = 200;
var DEFAULT_MAX_REVENUE = 1e6;
var CURRENCY_PATTERN = /^[A-Z]{3}$/;
var RESERVED_PROP_KEYS = /* @__PURE__ */ new Set(["revenue", "currency"]);
function toPathAndQuery(raw) {
  try {
    const parsed = new URL(raw, "https://placeholder.invalid");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}
function applyNormalizePath(config, path) {
  if (!config.normalizePath) {
    return path;
  }
  try {
    return config.normalizePath(path).split("?")[0];
  } catch (e) {
    console.error(e);
    return null;
  }
}
function toTrackedUrl(config, url) {
  const [rawPath, search] = toPathAndQuery(url).split("?");
  const path = applyNormalizePath(config, rawPath);
  if (path === null || config.blockedPathPrefixes.some((prefix) => path.startsWith(prefix))) {
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
function toTrackedReferrer(referrer) {
  if (typeof referrer !== "string" || referrer === "") {
    return "";
  }
  try {
    return new URL(referrer).origin;
  } catch {
    return "";
  }
}
function toEventProps(config, props) {
  const sanitized = {};
  if (!props) {
    return sanitized;
  }
  const maxLength = config.maxPropLength ?? DEFAULT_MAX_PROP_LENGTH;
  const record = props;
  for (const key of config.allowedPropKeys) {
    const value = record[key];
    if (RESERVED_PROP_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string" && value.trim() !== "") {
      sanitized[key] = value.trim().slice(0, maxLength);
    }
  }
  for (const key of config.allowedNumberPropKeys ?? []) {
    const value = record[key];
    if (RESERVED_PROP_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    }
  }
  const { revenue, currency } = props;
  const maxRevenue = config.maxRevenue ?? DEFAULT_MAX_REVENUE;
  const hasRevenue = typeof revenue === "number" && Number.isFinite(revenue) && revenue > 0 && revenue <= maxRevenue;
  const hasCurrency = typeof currency === "string" && CURRENCY_PATTERN.test(currency);
  if (hasRevenue && hasCurrency) {
    sanitized.revenue = Math.round(revenue * 100) / 100;
    sanitized.currency = currency;
  }
  return sanitized;
}
function sanitizeBeacon(config, payload) {
  if (!payload || typeof payload.url !== "string" || payload.url === "") {
    return payload;
  }
  const url = toTrackedUrl(config, payload.url);
  if (!url) {
    return null;
  }
  return { ...payload, url, referrer: toTrackedReferrer(payload.referrer) };
}
function isTrackedHost(config, hostname) {
  const normalized = hostname.replace(/\.$/, "").toLowerCase();
  return config.trackedHosts.some((host) => host.replace(/\.$/, "").toLowerCase() === normalized);
}

// src/client.ts
var DEFAULT_MAX_QUEUED_ITEMS = 20;
var BEFORE_SEND_CALLBACK = "__umamiBeforeSend";
function createClientAnalytics(config) {
  const maxQueued = config.maxQueuedItems ?? DEFAULT_MAX_QUEUED_ITEMS;
  let queued = [];
  let lastPageviewUrl = null;
  let activationListenerAttached = false;
  const isPrerendering = () => typeof document !== "undefined" && document.prerendering === true;
  const flushOnActivation = () => {
    if (activationListenerAttached || typeof document === "undefined") {
      return;
    }
    activationListenerAttached = true;
    document.addEventListener("prerenderingchange", () => flushQueue(), { once: true });
  };
  const enqueue = (item) => {
    if (queued.length < maxQueued) {
      queued.push(item);
    }
    if (isPrerendering()) {
      flushOnActivation();
    }
  };
  const sendPageview = (url) => {
    try {
      window.umami?.track((payload) => ({
        ...payload,
        url,
        referrer: toTrackedReferrer(payload.referrer)
      }));
    } catch (e) {
      console.error(e);
    }
  };
  const sendEvent = (name, props, url) => {
    try {
      window.umami?.track((payload) => ({
        ...payload,
        url,
        referrer: toTrackedReferrer(payload.referrer),
        name,
        data: toEventProps(config, props)
      }));
    } catch (e) {
      console.error(e);
    }
  };
  function flushQueue() {
    if (typeof window === "undefined" || !window.umami || queued.length === 0) {
      return;
    }
    if (isPrerendering()) {
      flushOnActivation();
      return;
    }
    const batch = queued;
    queued = [];
    for (const item of batch) {
      if (item.kind === "pageview") {
        sendPageview(item.url);
      } else {
        sendEvent(item.name, item.props, item.url);
      }
    }
  }
  return {
    beforeSendCallbackName: BEFORE_SEND_CALLBACK,
    installBeforeSend: () => {
      if (typeof window === "undefined") {
        return;
      }
      window[BEFORE_SEND_CALLBACK] = (_type, payload) => sanitizeBeacon(config, payload);
    },
    trackPageview: (url) => {
      if (typeof window === "undefined") {
        return;
      }
      const trackedUrl = toTrackedUrl(config, url);
      if (!trackedUrl || trackedUrl === lastPageviewUrl) {
        return;
      }
      lastPageviewUrl = trackedUrl;
      if (!window.umami || isPrerendering()) {
        enqueue({ kind: "pageview", url: trackedUrl });
        return;
      }
      sendPageview(trackedUrl);
    },
    trackEvent: (name, props) => {
      if (typeof window === "undefined") {
        return;
      }
      const url = toTrackedUrl(config, `${window.location.pathname}${window.location.search}`);
      if (!url) {
        return;
      }
      if (!window.umami || isPrerendering()) {
        enqueue({ kind: "event", name, props, url });
        return;
      }
      sendEvent(name, props, url);
    },
    flushQueue,
    isTracked: (hostname) => {
      const normalized = hostname.replace(/\.$/, "").toLowerCase();
      return config.trackedHosts.some(
        (host) => host.replace(/\.$/, "").toLowerCase() === normalized
      );
    },
    reset: () => {
      queued = [];
      lastPageviewUrl = null;
      activationListenerAttached = false;
    }
  };
}

// src/server.ts
var DEFAULT_TIMEOUT_MS = 3e3;
function createServerAnalytics(config, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    /**
     * Never throws and never blocks the response — measurement must not break a
     * conversion. Call without await, with a .catch().
     */
    sendEvent: async ({ name, props, url, hostname, ip, userAgent }) => {
      const hostUrl = (options.hostUrl || "").replace(/\/+$/, "");
      if (!hostUrl || !config.websiteId) {
        return;
      }
      if (!ip || !userAgent) {
        console.error("[vzb-analytics] missing client ip or user agent, event not sent:", name);
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
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "event",
            payload: {
              website: config.websiteId,
              hostname,
              url: trackedUrl,
              name,
              data: toEventProps(config, props),
              ip,
              userAgent
            }
          }),
          signal: controller.signal
        });
        if (!response.ok && response.status !== 403) {
          console.error("[vzb-analytics] send failed:", response.status, name);
        }
      } catch (e) {
        console.error("[vzb-analytics] unexpected error:", e);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
export {
  BEFORE_SEND_CALLBACK,
  createClientAnalytics,
  createServerAnalytics,
  isTrackedHost,
  sanitizeBeacon,
  toEventProps,
  toPathAndQuery,
  toTrackedReferrer,
  toTrackedUrl
};
