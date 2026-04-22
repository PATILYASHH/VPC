// Lightweight in-process pub/sub bus that fans out events to SSE clients.
// Channels are namespaced strings: e.g. 'metrics', 'jobs:deploy:42', 'logs:nginx'.

const EventEmitter = require('events');

class RealtimeBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.clients = new Set();
  }

  // Register an SSE client. Returns an unregister function.
  addClient(client) {
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  // Publish an event to a channel. payload is JSON-serialized.
  publish(channel, payload) {
    const msg = { channel, payload, ts: Date.now() };
    for (const client of this.clients) {
      if (client.subscribed.has(channel) || client.subscribed.has('*')) {
        client.send(msg);
      }
    }
    this.emit(channel, payload);
  }
}

module.exports = new RealtimeBus();
