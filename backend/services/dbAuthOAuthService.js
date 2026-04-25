// OAuth provider helpers for project DB Auth (Supabase-style).
// Currently supports Google. Each provider is configured per-project in the
// project's own auth_providers table; the public callback URL is shared:
//   {VPC_URL}/api/db/auth/v1/{slug}/callback/{provider}
//
// Flow:
//  1. Customer app redirects browser to /authorize/{provider}?redirect_to=...
//  2. We sign a short-lived state token containing { slug, provider, redirect_to }
//     and redirect to the provider's authorize endpoint with our shared callback.
//  3. Provider redirects back with ?code=...&state=...
//  4. We verify state, exchange the code for tokens, fetch the user profile,
//     find-or-create the auth_users row, and redirect to the customer's
//     redirect_to with #access_token=<jwt>&token_type=bearer&user=<base64-json>.

const crypto = require('crypto');
const { signToken, verifyToken } = require('../utils/jwt');

const PROVIDERS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    emailsUrl: 'https://api.github.com/user/emails',
    scope: 'read:user user:email',
  },
};

function getProviderSpec(provider) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`Unsupported provider: ${provider}`);
  return spec;
}

function buildCallbackUrl(req, slug, provider) {
  // Honour reverse-proxy headers so we generate the public URL the browser used
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}/api/db/auth/v1/${encodeURIComponent(slug)}/callback/${encodeURIComponent(provider)}`;
}

function signState({ slug, provider, redirectTo }) {
  return signToken({ slug, provider, redirectTo, n: crypto.randomBytes(8).toString('hex'), t: 'oauth_state' }, '10m');
}

function verifyState(token) {
  const decoded = verifyToken(token);
  if (decoded.t !== 'oauth_state') throw new Error('Invalid state token');
  return decoded;
}

function buildAuthorizeUrl({ provider, clientId, redirectUri, state, extraConfig }) {
  const spec = getProviderSpec(provider);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: spec.scope,
    state,
  });
  if (provider === 'google') {
    params.set('response_type', 'code');
    params.set('access_type', 'offline');
    params.set('prompt', 'select_account');
    if (extraConfig?.hosted_domain) params.set('hd', extraConfig.hosted_domain);
  }
  if (provider === 'github') {
    params.set('allow_signup', 'true');
  }
  return `${spec.authorizeUrl}?${params.toString()}`;
}

async function exchangeCodeForProfile({ provider, code, clientId, clientSecret, redirectUri }) {
  const spec = getProviderSpec(provider);
  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  if (provider === 'google') tokenBody.set('grant_type', 'authorization_code');

  const tokenRes = await fetch(spec.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: tokenBody.toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}`);
  }
  const tokenJson = await tokenRes.json();
  if (tokenJson.error) {
    throw new Error(`Token exchange error: ${tokenJson.error_description || tokenJson.error}`);
  }

  const userRes = await fetch(spec.userinfoUrl, {
    headers: {
      authorization: `${provider === 'github' ? 'token' : 'Bearer'} ${tokenJson.access_token}`,
      accept: provider === 'github' ? 'application/vnd.github+json' : 'application/json',
      'user-agent': 'VPC-DB-Auth',
    },
  });
  if (!userRes.ok) {
    const body = await userRes.text();
    throw new Error(`Userinfo fetch failed (${userRes.status}): ${body.slice(0, 200)}`);
  }
  const userJson = await userRes.json();

  if (provider === 'google') {
    // Google: { sub, email, email_verified, name, picture, ... }
    return {
      providerId: String(userJson.sub || userJson.id),
      email: userJson.email,
      emailVerified: userJson.email_verified !== false,
      fullName: userJson.name || userJson.given_name || null,
      avatarUrl: userJson.picture || null,
      raw: userJson,
    };
  }

  if (provider === 'github') {
    // GitHub: { id, login, name, avatar_url, email (sometimes null if private) }
    let email = userJson.email;
    let emailVerified = false;
    // If the primary email isn't on the public profile, fetch via /user/emails
    if (!email && spec.emailsUrl) {
      try {
        const emailsRes = await fetch(spec.emailsUrl, {
          headers: {
            authorization: `token ${tokenJson.access_token}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'VPC-DB-Auth',
          },
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json();
          const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
          if (primary) {
            email = primary.email;
            emailVerified = !!primary.verified;
          }
        }
      } catch {}
    } else if (email) {
      // GitHub doesn't expose verification on /user, so trust verified primary from /user/emails when possible
      emailVerified = true;
    }
    return {
      providerId: String(userJson.id),
      email,
      emailVerified,
      fullName: userJson.name || userJson.login || null,
      avatarUrl: userJson.avatar_url || null,
      raw: userJson,
    };
  }

  throw new Error(`Unhandled provider in profile mapping: ${provider}`);
}

module.exports = {
  PROVIDERS,
  buildCallbackUrl,
  signState,
  verifyState,
  buildAuthorizeUrl,
  exchangeCodeForProfile,
};
