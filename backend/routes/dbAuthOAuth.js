// Public OAuth routes for project DB Auth.
// Mounted at /api/db/auth/v1 — no apikey required because these are hit by the
// user's browser during a redirect dance with the OAuth provider.
//
//  GET  /:slug/authorize/:provider?redirect_to=...   → 302 to Google
//  GET  /:slug/callback/:provider?code=...&state=... → 302 to redirect_to with #access_token=...

const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');
const oauth = require('../services/dbAuthOAuthService');
const { signToken } = require('../utils/jwt');

async function resolveProjectBySlug(req, res, next) {
  try {
    const project = await dbService.getProjectBySlug(req.app.locals.pool, req.params.slug);
    if (!project) return res.status(404).send('Project not found');
    req.dbProject = project;
    req.dbPool = dbService.getProjectPool(project);
    next();
  } catch (err) {
    res.status(500).send('Internal error');
  }
}

router.get('/:slug/providers', resolveProjectBySlug, async (req, res) => {
  try {
    const providers = await dbService.getAuthProviders(req.dbPool);
    // Public view: only expose what's safe (no secrets, no client_id)
    res.json({
      providers: providers
        .filter((p) => p.enabled)
        .map((p) => ({ provider: p.provider, enabled: true })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:slug/authorize/:provider', resolveProjectBySlug, async (req, res) => {
  try {
    const provider = req.params.provider;
    if (!oauth.PROVIDERS[provider]) {
      return res.status(400).send(`Unsupported provider: ${provider}`);
    }

    const config = await dbService.getAuthProviderWithSecret(req.dbPool, provider);
    if (!config || !config.enabled) {
      return res.status(400).send(`${provider} sign-in is not enabled for this project`);
    }
    if (!config.client_id || !config.client_secret) {
      return res.status(400).send(`${provider} provider is missing client credentials`);
    }

    const redirectTo = req.query.redirect_to || '';
    const redirectUri = oauth.buildCallbackUrl(req, req.dbProject.slug, provider);
    const state = oauth.signState({ slug: req.dbProject.slug, provider, redirectTo });

    const url = oauth.buildAuthorizeUrl({
      provider,
      clientId: config.client_id,
      redirectUri,
      state,
      extraConfig: config.config,
    });
    res.redirect(302, url);
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

router.get('/:slug/callback/:provider', resolveProjectBySlug, async (req, res) => {
  try {
    const provider = req.params.provider;
    const { code, state, error: providerError } = req.query;

    if (providerError) {
      return res.status(400).send(`Provider error: ${providerError}`);
    }
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    let stateData;
    try {
      stateData = oauth.verifyState(state);
    } catch {
      return res.status(400).send('Invalid or expired state');
    }
    if (stateData.slug !== req.dbProject.slug || stateData.provider !== provider) {
      return res.status(400).send('State mismatch');
    }

    const config = await dbService.getAuthProviderWithSecret(req.dbPool, provider);
    if (!config || !config.enabled || !config.client_id || !config.client_secret) {
      return res.status(400).send(`${provider} sign-in is not configured`);
    }

    const redirectUri = oauth.buildCallbackUrl(req, req.dbProject.slug, provider);

    const profile = await oauth.exchangeCodeForProfile({
      provider,
      code,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      redirectUri,
    });

    if (!profile.email) {
      return res.status(400).send('Provider did not return an email');
    }
    if (!profile.emailVerified) {
      return res.status(400).send('Provider email is not verified');
    }

    const user = await dbService.findOrCreateOAuthUser(req.dbPool, {
      provider,
      providerId: profile.providerId,
      email: profile.email,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
    });

    const accessToken = signToken({
      sub: user.id,
      email: user.email,
      project: req.dbProject.id,
      provider,
      type: 'db_user',
    });

    const userPayload = Buffer.from(
      JSON.stringify({
        id: user.id,
        email: user.email,
        provider,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      })
    ).toString('base64');

    if (stateData.redirectTo) {
      const sep = stateData.redirectTo.includes('#') ? '&' : '#';
      return res.redirect(
        302,
        `${stateData.redirectTo}${sep}access_token=${encodeURIComponent(accessToken)}&token_type=bearer&user=${encodeURIComponent(userPayload)}`
      );
    }

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        provider,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

module.exports = router;
