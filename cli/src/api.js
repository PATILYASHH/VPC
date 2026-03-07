export async function fetchMigration(config) {
  const res = await fetch(`${config.url}/pull/migration`, {
    headers: { apikey: config.key },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function ackPull(config, changeId) {
  const res = await fetch(`${config.url}/pull/ack`, {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ change_id: changeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchStatus(config) {
  const res = await fetch(`${config.url}/pull/status`, {
    headers: { apikey: config.key },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
