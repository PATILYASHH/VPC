const { execFile } = require('child_process');
const { decrypt, encrypt } = require('../utils/encryption');

// ─── Provider Definitions ────────────────────────────────────

const PROVIDERS = {
  'claude-cli': {
    name: 'Claude CLI',
    description: 'Free — uses locally installed Claude CLI',
    requiresKey: false,
    costTier: 'free',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
    defaultModel: 'claude-sonnet-4-20250514',
    settingKey: null,
  },
  anthropic: {
    name: 'Anthropic',
    description: 'Claude API — direct API access',
    requiresKey: true,
    costTier: 'medium',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
    defaultModel: 'claude-sonnet-4-20250514',
    settingKey: 'ai_provider_anthropic_key',
  },
  openai: {
    name: 'OpenAI',
    description: 'GPT models — GPT-4o, GPT-4.1, o3',
    requiresKey: true,
    costTier: 'medium-high',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini'],
    defaultModel: 'gpt-4o',
    settingKey: 'ai_provider_openai_key',
  },
  gemini: {
    name: 'Google Gemini',
    description: 'Gemini models — fast and capable',
    requiresKey: true,
    costTier: 'low-medium',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    settingKey: 'ai_provider_google_key',
  },
  ollama: {
    name: 'Ollama',
    description: 'Free — run models locally on your server',
    requiresKey: false,
    costTier: 'free',
    models: [], // dynamically loaded
    defaultModel: 'llama3.1',
    settingKey: null,
  },
  groq: {
    name: 'Groq',
    description: 'Ultra-fast inference — low cost',
    requiresKey: true,
    costTier: 'low',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    defaultModel: 'llama-3.3-70b-versatile',
    settingKey: 'ai_provider_groq_key',
  },
  mistral: {
    name: 'Mistral',
    description: 'Mistral models — efficient and capable',
    requiresKey: true,
    costTier: 'low',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    defaultModel: 'mistral-large-latest',
    settingKey: 'ai_provider_mistral_key',
  },
};

// ─── Key/Config Helpers ──────────────────────────────────────

async function getProviderKey(pool, providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider?.settingKey) return null;
  const { rows } = await pool.query('SELECT value FROM vpc_settings WHERE key = $1', [provider.settingKey]);
  if (!rows[0]?.value) return null;
  return decrypt(rows[0].value);
}

async function getProviderModel(pool, providerId) {
  const { rows } = await pool.query('SELECT value FROM vpc_settings WHERE key = $1', [`ai_provider_${providerId}_model`]);
  return rows[0]?.value || PROVIDERS[providerId]?.defaultModel;
}

async function getDefaultProvider(pool) {
  const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'ai_default_provider'");
  return rows[0]?.value || 'claude-cli';
}

async function setDefaultProvider(pool, providerId) {
  if (!PROVIDERS[providerId]) throw new Error(`Unknown provider: ${providerId}`);
  await pool.query(
    `INSERT INTO vpc_settings (key, value, updated_at) VALUES ('ai_default_provider', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [providerId]
  );
}

async function setProviderConfig(pool, providerId, { apiKey, model } = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  if (apiKey && provider.settingKey) {
    await pool.query(
      `INSERT INTO vpc_settings (key, value, is_secret, updated_at) VALUES ($1, $2, TRUE, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, is_secret = TRUE, updated_at = NOW()`,
      [provider.settingKey, encrypt(apiKey)]
    );
  }

  if (model) {
    await pool.query(
      `INSERT INTO vpc_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [`ai_provider_${providerId}_model`, model]
    );
  }
}

// ─── Availability Checks ─────────────────────────────────────

async function isClaudeCliAvailable() {
  return new Promise(resolve => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => resolve(!err));
  });
}

async function isOllamaAvailable() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

async function isProviderAvailable(pool, providerId) {
  if (providerId === 'claude-cli') return isClaudeCliAvailable();
  if (providerId === 'ollama') return isOllamaAvailable();
  const key = await getProviderKey(pool, providerId);
  return !!key;
}

async function isAnyAvailable(pool) {
  for (const id of Object.keys(PROVIDERS)) {
    if (await isProviderAvailable(pool, id)) return true;
  }
  return false;
}

async function getAvailableProviders(pool) {
  const results = [];
  for (const [id, info] of Object.entries(PROVIDERS)) {
    const available = await isProviderAvailable(pool, id);
    const model = await getProviderModel(pool, id);
    let models = [...info.models];

    // For Ollama, fetch actual installed models
    if (id === 'ollama' && available) {
      try {
        const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        models = (data.models || []).map(m => m.name);
      } catch {}
    }

    results.push({
      id,
      name: info.name,
      description: info.description,
      requiresKey: info.requiresKey,
      costTier: info.costTier,
      models,
      currentModel: model,
      available,
    });
  }
  return results;
}

// ─── Provider Adapters ───────────────────────────────────────

function buildTextPrompt(system, messages) {
  let text = '';
  if (system) text += `${system}\n\n`;
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'Assistant' : 'User';
    text += `${role}: ${m.content}\n\n`;
  }
  return text.trim();
}

async function callClaudeCli(system, messages, options = {}) {
  const prompt = buildTextPrompt(system, messages);
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'text'];
    if (options.model) args.push('--model', options.model);
    execFile('claude', args, {
      timeout: options.timeout || 180000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.message + (stderr || '')));
      resolve({ text: stdout.trim(), model: options.model || 'claude-cli', provider: 'claude-cli' });
    });
  });
}

async function callAnthropic(apiKey, system, messages, options = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: options.model || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    system: system || undefined,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });
  const text = response.content.map(c => c.text || '').join('');
  return {
    text,
    model: response.model,
    provider: 'anthropic',
    usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens },
  };
}

async function callOpenAICompatible(baseURL, apiKey, system, messages, options = {}) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages.map(m => ({ role: m.role, content: m.content })));
  const response = await client.chat.completions.create({
    model: options.model || 'gpt-4o',
    max_tokens: options.maxTokens || 4096,
    messages: msgs,
  });
  const choice = response.choices?.[0];
  return {
    text: choice?.message?.content || '',
    model: response.model,
    provider: options.providerId || 'openai',
    usage: { input: response.usage?.prompt_tokens, output: response.usage?.completion_tokens },
  };
}

async function callGemini(apiKey, system, messages, options = {}) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: options.model || 'gemini-2.5-flash',
    systemInstruction: system || undefined,
  });
  // Convert messages to Gemini format
  const history = [];
  for (let i = 0; i < messages.length - 1; i++) {
    history.push({
      role: messages[i].role === 'assistant' ? 'model' : 'user',
      parts: [{ text: messages[i].content }],
    });
  }
  const lastMessage = messages[messages.length - 1]?.content || '';
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage);
  const text = result.response.text();
  return {
    text,
    model: options.model || 'gemini-2.5-flash',
    provider: 'gemini',
    usage: { input: result.response.usageMetadata?.promptTokenCount, output: result.response.usageMetadata?.candidatesTokenCount },
  };
}

async function callOllama(system, messages, options = {}) {
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages.map(m => ({ role: m.role, content: m.content })));
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model || 'llama3.1',
      messages: msgs,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.message?.content || '',
    model: data.model,
    provider: 'ollama',
    usage: { input: data.prompt_eval_count, output: data.eval_count },
  };
}

// ─── Main Chat Function ──────────────────────────────────────

async function chat(prompt, options = {}) {
  const { pool, provider: requestedProvider, model: requestedModel, system, messages, timeout, maxTokens } = options;

  // Normalize input: string prompt → messages array
  let chatMessages = messages || [];
  let chatSystem = system || '';
  if (typeof prompt === 'string' && prompt && chatMessages.length === 0) {
    chatMessages = [{ role: 'user', content: prompt }];
  }

  // Resolve provider
  let providerId = requestedProvider;
  if (!providerId && pool) providerId = await getDefaultProvider(pool);
  if (!providerId) providerId = 'claude-cli';

  // Verify availability, fallback chain
  if (pool && !(await isProviderAvailable(pool, providerId))) {
    const fallbacks = ['claude-cli', 'anthropic', 'ollama', 'openai', 'groq', 'gemini', 'mistral'];
    let found = false;
    for (const fb of fallbacks) {
      if (fb !== providerId && await isProviderAvailable(pool, fb)) {
        providerId = fb;
        found = true;
        break;
      }
    }
    if (!found) throw new Error('No AI provider available. Configure an API key or install Claude CLI / Ollama.');
  }

  // Resolve model
  const model = requestedModel || (pool ? await getProviderModel(pool, providerId) : PROVIDERS[providerId]?.defaultModel);

  // Route to adapter
  switch (providerId) {
    case 'claude-cli':
      return callClaudeCli(chatSystem, chatMessages, { model, timeout });

    case 'anthropic': {
      const key = pool ? await getProviderKey(pool, 'anthropic') : process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('Anthropic API key not configured');
      return callAnthropic(key, chatSystem, chatMessages, { model, maxTokens });
    }

    case 'openai': {
      const key = pool ? await getProviderKey(pool, 'openai') : null;
      if (!key) throw new Error('OpenAI API key not configured');
      return callOpenAICompatible(null, key, chatSystem, chatMessages, { model, maxTokens, providerId: 'openai' });
    }

    case 'gemini': {
      const key = pool ? await getProviderKey(pool, 'gemini') : null;
      if (!key) throw new Error('Google AI API key not configured');
      return callGemini(key, chatSystem, chatMessages, { model, maxTokens });
    }

    case 'ollama':
      return callOllama(chatSystem, chatMessages, { model, timeout });

    case 'groq': {
      const key = pool ? await getProviderKey(pool, 'groq') : null;
      if (!key) throw new Error('Groq API key not configured');
      return callOpenAICompatible('https://api.groq.com/openai/v1', key, chatSystem, chatMessages, { model, maxTokens, providerId: 'groq' });
    }

    case 'mistral': {
      const key = pool ? await getProviderKey(pool, 'mistral') : null;
      if (!key) throw new Error('Mistral API key not configured');
      return callOpenAICompatible('https://api.mistral.ai/v1', key, chatSystem, chatMessages, { model, maxTokens, providerId: 'mistral' });
    }

    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

// ─── Test Provider ───────────────────────────────────────────

async function testProvider(pool, providerId) {
  const start = Date.now();
  try {
    const result = await chat('Say "hello" in one word.', { pool, provider: providerId, maxTokens: 50 });
    return { ok: true, latency: Date.now() - start, response: result.text.slice(0, 100), model: result.model };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: err.message };
  }
}

// ─── Ollama Management ───────────────────────────────────────

async function getOllamaStatus() {
  const available = await isOllamaAvailable();
  if (!available) return { installed: false, running: false, models: [] };
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
      digest: m.digest?.slice(0, 12),
    }));
    return { installed: true, running: true, models };
  } catch {
    return { installed: true, running: false, models: [] };
  }
}

async function pullOllamaModel(modelName) {
  const res = await fetch('http://localhost:11434/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: false }),
  });
  if (!res.ok) throw new Error(`Failed to pull model: ${await res.text()}`);
  return await res.json();
}

async function deleteOllamaModel(modelName) {
  const res = await fetch('http://localhost:11434/api/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
  });
  if (!res.ok) throw new Error(`Failed to delete model: ${await res.text()}`);
  return { deleted: true };
}

module.exports = {
  PROVIDERS,
  chat,
  getAvailableProviders,
  getDefaultProvider,
  setDefaultProvider,
  setProviderConfig,
  getProviderKey,
  getProviderModel,
  isProviderAvailable,
  isAnyAvailable,
  testProvider,
  getOllamaStatus,
  pullOllamaModel,
  deleteOllamaModel,
};
