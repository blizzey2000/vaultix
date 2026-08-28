const net = require('net');
const crypto = require('crypto');

class DiscordRPC {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.clientId = null;
  }

  connect(clientId) {
    if (this.connected) return Promise.resolve();
    this.clientId = clientId;

    return new Promise((resolve, reject) => {
      const tryPipe = (i) => {
        if (i > 9) return reject(new Error('Discord not running'));
        const pipePath = '\\\\.\\pipe\\discord-ipc-' + i;
        const sock = net.createConnection(pipePath);

        sock.once('connect', () => {
          this.socket = sock;
          this._send(0, { v: 1, client_id: clientId });
          this.connected = true;
          sock.on('error', () => this._cleanup());
          sock.on('close', () => this._cleanup());
          setTimeout(resolve, 300);
        });

        sock.once('error', () => {
          sock.destroy();
          tryPipe(i + 1);
        });
      };
      tryPipe(0);
    });
  }

  _send(opcode, payload) {
    if (!this.socket) return;
    const json = JSON.stringify(payload);
    const len = Buffer.byteLength(json);
    const buf = Buffer.alloc(8 + len);
    buf.writeInt32LE(opcode, 0);
    buf.writeInt32LE(len, 4);
    buf.write(json, 8);
    try { this.socket.write(buf); } catch (e) { /* silent */ }
  }

  setActivity(details, state, startTimestamp) {
    const activity = {};
    if (details) activity.details = details.substring(0, 128);
    if (state) activity.state = state.substring(0, 128);
    if (startTimestamp) activity.timestamps = { start: Math.floor(startTimestamp / 1000) };
    this._send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: crypto.randomUUID(),
    });
  }

  clearActivity() {
    this._send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid },
      nonce: crypto.randomUUID(),
    });
  }

  _cleanup() {
    this.connected = false;
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) { /* silent */ }
      this.socket = null;
    }
  }

  disconnect() {
    if (this.connected) {
      try { this._send(2, {}); } catch (e) { /* silent */ }
    }
    this._cleanup();
  }
}

module.exports = { DiscordRPC };
