import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { type AuthedRequest, requireAuth } from '../middleware/auth.ts';

export const discordAuthRouter = Router();

interface OAuthStateEntry {
  uid: string;
  redirectUri: string;
  createdAt: number;
}

const pendingStates = new Map<string, OAuthStateEntry>();

function readCleanEnv(name: string): string {
  const raw = process.env[name] || '';
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

export function getDiscordRedirectUri(): string {
  const rawAppUrl = readCleanEnv('APP_URL');
  const port = readCleanEnv('PORT') || '3000';
  const fallbackOrigin = `http://localhost:${port}`;

  const candidate =
    rawAppUrl && rawAppUrl !== 'MY_APP_URL' ? rawAppUrl.replace(/\/+$/, '') : fallbackOrigin;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return `${parsed.origin}/auth/discord/callback`;
  } catch (err) {
    console.warn('[Discord OAuth] Invalid APP_URL format; falling back to localhost callback:', {
      appUrlValid: false,
      reason: err instanceof Error ? err.message : 'parse_error',
    });
    return `${fallbackOrigin}/auth/discord/callback`;
  }
}

export function getDiscordConfig() {
  const clientId = readCleanEnv('DISCORD_CLIENT_ID');
  const clientSecret = readCleanEnv('DISCORD_CLIENT_SECRET');
  const clientIdValid = /^\d{15,25}$/.test(clientId);
  return {
    clientId,
    clientSecret,
    clientIdValid,
    configured: Boolean(clientId && clientSecret),
  };
}

export function buildDiscordAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  // Validate absolute redirect URI before constructing the authorization URL
  const validatedRedirect = new URL(redirectUri).toString();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: validatedRedirect,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

discordAuthRouter.get('/api/oauth/discord/status', (_req, res) => {
  const { configured, clientIdValid } = getDiscordConfig();
  const redirectUri = getDiscordRedirectUri();
  res.json({
    configured,
    clientIdValid,
    redirectUri,
  });
});

discordAuthRouter.get('/api/oauth/discord/url', requireAuth, (req: AuthedRequest, res) => {
  const { clientId, clientSecret, clientIdValid, configured } = getDiscordConfig();
  const redirectUri = getDiscordRedirectUri();

  if (!configured) {
    console.warn('[Discord OAuth] Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET.', {
      redirectUri,
      appUrlConfigured: Boolean(readCleanEnv('APP_URL')),
    });
    res.status(503).json({
      error:
        'Discord OAuth2 is not configured yet. Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in AI Studio Secrets.',
      redirectUri,
    });
    return;
  }

  if (!clientIdValid) {
    console.error('[Discord OAuth] DISCORD_CLIENT_ID format is invalid (expected Discord Application ID digits).', {
      redirectUri,
      clientIdLength: clientId.length,
    });
    res.status(500).json({
      error:
        'DISCORD_CLIENT_ID appears invalid. Set it to your numeric Discord Application ID from Discord Developer Portal.',
      redirectUri,
    });
    return;
  }

  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, {
    uid: req.user!.uid,
    redirectUri,
    createdAt: Date.now(),
  });

  // Clean up expired states (>10m)
  for (const [key, entry] of pendingStates.entries()) {
    if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
      pendingStates.delete(key);
    }
  }

  res.cookie('ss_discord_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 10 * 60 * 1000,
  });

  const authUrl = buildDiscordAuthorizeUrl(clientId, redirectUri, state);

  console.info('[Discord OAuth] Prepared authorization request:', {
    redirectUri,
    appUrlConfigured: Boolean(readCleanEnv('APP_URL')),
    clientIdValid,
  });

  res.json({
    url: authUrl,
    redirectUri,
  });
});

async function handleDiscordCallback(req: AuthedRequest, res: Response): Promise<void> {
  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  const oauthError = String(req.query.error || '').trim();
  const oauthErrorDesc = String(req.query.error_description || '').trim();

  if (oauthError) {
    console.warn('[Discord OAuth] Provider returned authorization error:', {
      oauthError,
      redirectUri: getDiscordRedirectUri(),
    });
    const detail = oauthErrorDesc ? `${oauthError}: ${oauthErrorDesc}` : oauthError;
    res.status(400).send(renderPopupResponse({ type: 'DISCORD_OAUTH_ERROR', error: detail }));
    return;
  }

  const storedState = pendingStates.get(state);
  if (!code || !state || !storedState) {
    console.warn('[Discord OAuth] Callback state validation failed:', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      stateMatched: Boolean(storedState),
      redirectUri: getDiscordRedirectUri(),
    });
    res.status(400).send(
      renderPopupResponse({
        type: 'DISCORD_OAUTH_ERROR',
        error: 'Invalid or expired OAuth state. Please try connecting Discord again.',
      })
    );
    return;
  }

  pendingStates.delete(state);
  // Always exchange using the exact redirect_uri that initiated this state
  const redirectUri = storedState.redirectUri;

  console.info('[Discord OAuth] Callback received; exchanging authorization code:', {
    redirectUri,
    hasCode: true,
  });

  const { clientId, clientSecret, configured } = getDiscordConfig();
  if (!configured) {
    res.status(503).send(
      renderPopupResponse({
        type: 'DISCORD_OAUTH_ERROR',
        error: 'Discord credentials missing on server.',
      })
    );
    return;
  }

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      let safeReason = `HTTP ${tokenRes.status}`;
      try {
        const errJson = (await tokenRes.json()) as {
          error?: string;
          error_description?: string;
        };
        if (errJson?.error) {
          safeReason = errJson.error_description
            ? `${errJson.error}: ${errJson.error_description}`
            : errJson.error;
        }
      } catch {
        // Ignore parse failures
      }
      console.warn('[Discord OAuth] Token exchange failed:', {
        status: tokenRes.status,
        reason: safeReason,
        redirectUri,
      });
      res.status(400).send(
        renderPopupResponse({
          type: 'DISCORD_OAUTH_ERROR',
          error: `Token exchange failed (${safeReason}). Verify Discord redirect URI matches: ${redirectUri}`,
        })
      );
      return;
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      res.status(400).send(
        renderPopupResponse({
          type: 'DISCORD_OAUTH_ERROR',
          error: 'No access token returned by Discord.',
        })
      );
      return;
    }

    const profileRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    if (!profileRes.ok) {
      res.status(400).send(
        renderPopupResponse({
          type: 'DISCORD_OAUTH_ERROR',
          error: 'Failed to fetch Discord public profile.',
        })
      );
      return;
    }

    const profile = (await profileRes.json()) as {
      id: string;
      username: string;
      global_name?: string;
      avatar?: string;
    };

    const avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${profile.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
      : '';

    res.send(
      renderPopupResponse({
        type: 'DISCORD_OAUTH_SUCCESS',
        profile: {
          discordId: profile.id,
          discordUsername: profile.global_name || profile.username,
          discordAvatar: avatarUrl,
        },
      })
    );
  } catch (err) {
    console.error('[Discord OAuth] Callback exception:', {
      redirectUri,
      message: err instanceof Error ? err.message : 'unexpected_error',
    });
    res.status(500).send(
      renderPopupResponse({
        type: 'DISCORD_OAUTH_ERROR',
        error: err instanceof Error ? err.message : 'Unexpected OAuth callback error',
      })
    );
  }
}

function renderPopupResponse(payload: Record<string, unknown>): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
  <head><title>ShadowSpace Discord Link</title></head>
  <body style="background:#0B0C10;color:#e4e4e7;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;padding:24px;">
      <p style="font-size:15px;">Completing Discord account connection…</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage(${safeJson}, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
  </body>
</html>`;
}

discordAuthRouter.get(['/auth/discord/callback', '/auth/discord/callback/'], handleDiscordCallback);
