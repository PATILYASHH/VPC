const express = require('express');
const agentApiAuth = require('../middleware/agentApiAuth');

const router = express.Router();

router.use(agentApiAuth);

// GET /api/agent/v1/me — key info (so clients can check what they're allowed to do)
router.get('/me', (req, res) => {
  const k = req.agentKey;
  res.json({
    name: k.name,
    key_type: k.key_type || 'bot',
    permissions: k.permissions,
    store_history: k.store_history,
    rate_limit_per_minute: k.rate_limit_per_minute,
    expires_at: k.expires_at,
  });
});

// POST /api/agent/v1/chat — full bot chat (tools gated by key permissions).
// Body: { message, history?: [{role, content}] }
// When the key has store_history=false the exchange is NOT saved to VPC
// history — pass `history` yourself to keep multi-turn context.
router.post('/chat', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (req.agentKey.key_type === 'claude') {
      return res.status(403).json({ error: 'This is a Claude CLI key — it cannot access the VPC Bot. Use POST /api/agent/v1/ask instead.' });
    }
    const { message, history, provider, model } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const aiAgent = require('../services/aiAgentService');
    const result = await aiAgent.chat(message, null, pool, {
      channel: 'api',
      provider,
      model,
      apiKey: req.agentKey,
      clientHistory: Array.isArray(history) ? history : null,
    });
    res.json({ ...result, tracked: req.agentKey.store_history === true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/v1/ask — direct Claude (CLI) prompt, no tools, no system
// context, never stored. Requires the "claude" permission. Body: { prompt }
router.post('/ask', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (req.agentKey.permissions?.claude !== true) {
      return res.status(403).json({ error: 'API key permission denied: direct Claude access requires the "claude" permission.' });
    }
    const { prompt, provider, model } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const aiProvider = require('../services/aiProviderService');
    const ok = await aiProvider.isAnyAvailable(pool);
    if (!ok) return res.status(503).json({ error: 'No AI provider available' });

    const result = await aiProvider.chat(prompt, { pool, provider, model });
    res.json({ response: result.text, model: result.model, tracked: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
