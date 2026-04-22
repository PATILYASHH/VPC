// Single point any backend service uses to obtain credentials for an external system.
//
// Usage from anywhere on the backend:
//   const cr = require('./credentialResolver');
//   const gh = await cr.require(pool, 'github', { app: 'vpshub', resourceKind: 'repo', resourceId: repoId });
//   gh.credentials.token  // ← decrypted token, ready to use
//
// Behavior:
//   1. If `integrationId` is passed, that exact integration is used.
//   2. Otherwise the type's default is used.
//   3. If neither resolves, `require()` throws a structured error so the API can
//      respond with 412 + machine-readable hint that the frontend uses to render
//      a "Connect now" CTA pointing to the Connections app.

const integrationService = require('./integrationService');

class IntegrationMissingError extends Error {
  constructor(type) {
    super(`No ${type} integration is connected. Open the Connections app and connect a ${type} account.`);
    this.code = 'INTEGRATION_MISSING';
    this.statusCode = 412;
    this.integrationType = type;
  }
}

async function resolve(pool, type, opts = {}) {
  const { integrationId, app, resourceKind, resourceId } = opts;
  const result = await integrationService.resolveCredentials(pool, { type, integrationId });
  if (!result) return null;
  if (app) {
    integrationService.recordUse(pool, {
      integrationId: result.integration.id, appId: app, resourceKind, resourceId,
    }).catch(() => {});
  }
  return result;
}

async function require_(pool, type, opts = {}) {
  const result = await resolve(pool, type, opts);
  if (!result) throw new IntegrationMissingError(type);
  return result;
}

module.exports = {
  resolve,
  require: require_,
  IntegrationMissingError,
};
