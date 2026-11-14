export interface NormalizedIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServerResolution {
  ice_servers: NormalizedIceServer[];
  iceServers: NormalizedIceServer[];
  ttl: number;
  provider: 'twilio' | 'stun_fallback';
  turnConfigured: boolean;
}

export const GOOGLE_STUN_FALLBACK: NormalizedIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const TWILIO_TIMEOUT_MS = 5000;

interface TwilioRawIceServer {
  url?: string;
  urls?: string | string[];
  username?: string;
  credential?: string;
}

interface TwilioTokenResponse {
  ttl?: string | number;
  ice_servers?: TwilioRawIceServer[];
}

export interface TwilioNtsOptions {
  accountSid?: string;
  apiKey?: string;
  apiSecret?: string;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
}

function normalizeIceServers(rawList: unknown): NormalizedIceServer[] {
  if (!Array.isArray(rawList)) return [];
  const normalized: NormalizedIceServer[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as TwilioRawIceServer;
    const urls = raw.urls ?? raw.url;
    const hasValidUrls =
      (typeof urls === 'string' && urls.trim().length > 0) ||
      (Array.isArray(urls) && urls.some((u) => typeof u === 'string' && u.trim().length > 0));

    if (!hasValidUrls) continue;

    const entry: NormalizedIceServer = { urls };
    if (typeof raw.username === 'string' && raw.username.length > 0) {
      entry.username = raw.username;
    }
    if (typeof raw.credential === 'string' && raw.credential.length > 0) {
      entry.credential = raw.credential;
    }
    normalized.push(entry);
  }

  return normalized;
}

function buildFallbackResult(): IceServerResolution {
  return {
    ice_servers: GOOGLE_STUN_FALLBACK,
    iceServers: GOOGLE_STUN_FALLBACK,
    ttl: DEFAULT_TOKEN_TTL_SECONDS,
    provider: 'stun_fallback',
    turnConfigured: false,
  };
}

/**
 * Requests an ephemeral Network Traversal Service (NTS) token from Twilio.
 * Always falls back to Google STUN servers if Twilio credentials are absent or the request fails.
 * Never logs or returns Twilio Account SID, API Key, or API Secret.
 */
export async function getDynamicIceServers(
  options: TwilioNtsOptions = {}
): Promise<IceServerResolution> {
  const accountSid = (options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? '').trim();
  const apiKey = (options.apiKey ?? process.env.TWILIO_API_KEY ?? '').trim();
  const apiSecret = (options.apiSecret ?? process.env.TWILIO_API_SECRET ?? '').trim();
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  const fetchFn = options.fetchImpl ?? fetch;

  if (!accountSid || !apiKey || !apiSecret) {
    return buildFallbackResult();
  }

  if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid)) {
    console.warn('[ICE] Invalid Twilio Account SID format configured; falling back to Google STUN.');
    return buildFallbackResult();
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`;
  const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ Ttl: String(ttlSeconds) }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[ICE] Twilio NTS token request failed with HTTP ${response.status}; using STUN fallback.`);
      return buildFallbackResult();
    }

    const payload = (await response.json()) as TwilioTokenResponse;
    const iceServers = normalizeIceServers(payload?.ice_servers);
    if (iceServers.length === 0) {
      console.warn('[ICE] Twilio NTS returned an empty ice_servers array; using STUN fallback.');
      return buildFallbackResult();
    }

    const parsedTtl = Number(payload?.ttl);
    const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : ttlSeconds;

    return {
      ice_servers: iceServers,
      iceServers,
      ttl,
      provider: 'twilio',
      turnConfigured: true,
    };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network_error';
    console.warn(`[ICE] Twilio NTS unreachable (${reason}); using STUN fallback.`);
    return buildFallbackResult();
  } finally {
    clearTimeout(timeout);
  }
}
