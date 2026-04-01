/**
 * VPC VCS Remote Client
 * Communicates with VPC VCS server via HTTP
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { vpcDir } = require('./core/objects');

function readConfig(root) {
  const configPath = path.join(vpcDir(root), 'config');
  if (!fs.existsSync(configPath)) return { remotes: {} };
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { remotes: {} };
  }
}

function writeConfig(root, config) {
  fs.writeFileSync(path.join(vpcDir(root), 'config'), JSON.stringify(config, null, 2));
}

function getRemote(root, name = 'origin') {
  const config = readConfig(root);
  return config.remotes[name] || null;
}

function setRemote(root, name, url, username, token) {
  const config = readConfig(root);
  config.remotes[name] = { url, username, token };
  writeConfig(root, config);
}

function removeRemote(root, name) {
  const config = readConfig(root);
  delete config.remotes[name];
  writeConfig(root, config);
}

function makeClient(remote) {
  const headers = {};
  if (remote.username && remote.token) {
    const auth = Buffer.from(`${remote.username}:${remote.token}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }
  return axios.create({
    baseURL: remote.url,
    headers,
    maxContentLength: 200 * 1024 * 1024,
    maxBodyLength: 200 * 1024 * 1024,
    timeout: 120000,
  });
}

/**
 * Fetch remote refs
 */
async function fetchRefs(remote) {
  const client = makeClient(remote);
  const { data } = await client.post('/refs', {});
  return data;
}

/**
 * Negotiate push — tell server what refs we want to update
 */
async function negotiatePush(remote, refUpdates, haves) {
  const client = makeClient(remote);
  const { data } = await client.post('/negotiate', {
    operation: 'push',
    refs: refUpdates,
    haves,
  });
  return data;
}

/**
 * Push objects and update refs
 */
async function pushObjects(remote, objectsPayload, refUpdates) {
  const client = makeClient(remote);
  const { data } = await client.post('/push', {
    objects: objectsPayload,
    refs: refUpdates,
  }, {
    headers: { 'Content-Type': 'application/json' },
  });
  return data;
}

/**
 * Negotiate pull — tell server what we want and what we have
 */
async function negotiatePull(remote, wants, haves) {
  const client = makeClient(remote);
  const { data } = await client.post('/negotiate', {
    operation: 'pull',
    wants,
    haves,
  });
  return data;
}

/**
 * Pull objects from remote
 */
async function pullObjects(remote, wants, haves) {
  const client = makeClient(remote);
  const { data } = await client.post('/pull', {
    wants,
    haves,
  });
  return data;
}

module.exports = {
  readConfig, writeConfig,
  getRemote, setRemote, removeRemote,
  fetchRefs, negotiatePush, pushObjects,
  negotiatePull, pullObjects,
};
