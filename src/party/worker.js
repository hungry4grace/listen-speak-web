// Cloudflare Worker entry (聽說): runs the existing PartyKit server (server.js) on
// PartyServer in our own Cloudflare account. PartyKit's hosted platform
// stopped taking deploys on 16 Oct 2026 and shuts down on 23 Oct 2026.
//
// server.js was written against PartyKit's Party.Server API and only uses a
// small part of it — room.id / storage / env / broadcast / getConnections —
// so instead of rewriting it, this file hands it a `room` object built from
// PartyServer's equivalents and forwards the lifecycle hooks (PartyKit's
// onMessage(message, sender) is PartyServer's onMessage(connection, message)).
//
// URLs stay PartyKit-shaped: routePartykitRequest serves /parties/<party>/<room>
// and the binding "Main" becomes the party "main", so every path the app uses
// (/parties/main/global-auth-db/…, /parties/main/<game room>) keeps working —
// only the host name changes.
import { Server as PartyServer, routePartykitRequest } from 'partyserver';
import LegacyServer from './server.js';

export class Main extends PartyServer {
  legacy() {
    if (!this._legacy) {
      const self = this;
      const room = {
        get id() { return self.name; },
        storage: this.ctx.storage,
        env: this.env,
        broadcast: (message, without) => this.broadcast(message, without || []),
        getConnections: () => this.getConnections(),
        getConnection: (id) => this.getConnection(id),
        // Tells server.js it runs here, not on PartyKit (/admin/export is
        // PartyKit-only).
        partyserver: true,
      };
      this._legacy = new LegacyServer(room);
    }
    return this._legacy;
  }

  onRequest(request) {
    return this.legacy().onRequest(request);
  }

  onConnect(connection, ctx) {
    return this.legacy().onConnect(connection, ctx);
  }

  onMessage(connection, message) {
    return this.legacy().onMessage(message, connection);
  }

  onClose(connection) {
    const s = this.legacy();
    return typeof s.onClose === 'function' ? s.onClose(connection) : undefined;
  }

  onError(connection, error) {
    const s = this.legacy();
    return typeof s.onError === 'function' ? s.onError(connection, error) : undefined;
  }
}

export default {
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) || new Response('Not Found', { status: 404 });
  },
};
