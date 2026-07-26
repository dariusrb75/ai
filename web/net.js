/**
 * WebSocket transport to the Android host.
 *
 * Everything here assumes a flaky link: a phone that locks, a hotspot that drops, Safari
 * suspending a backgrounded tab. Reconnection is automatic and re-sends `hello` with the same
 * persisted token, which is what makes the server hand back the same seat and the same game.
 */

const TOKEN_KEY = 'offlinechess.token';
const NAME_KEY = 'offlinechess.name';

/** localStorage throws in some privacy modes, so every access is guarded. */
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* Private browsing: fall back to a session-only value. */
  }
}

let memoryToken = null;

/**
 * A stable per-device identity. This is the whole basis of reconnect: lose the token and the
 * server sees a stranger, hands out the remaining seat, and the game looks lost.
 */
export function playerToken() {
  const stored = readStored(TOKEN_KEY);
  if (stored) return stored;
  if (memoryToken) return memoryToken;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  writeStored(TOKEN_KEY, token);
  memoryToken = token;
  return token;
}

export function savedName() {
  return readStored(NAME_KEY) || '';
}

export function saveName(name) {
  writeStored(NAME_KEY, name);
}

export class Connection {
  /**
   * @param {object} handlers onState, onWelcome, onClock, onServerError, onLink
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.socket = null;
    this.name = 'Player';
    this.preferredColor = '';
    this.closedByUs = false;
    this.retryDelay = 400;
    this.retryTimer = null;
  }

  connect(name, preferredColor) {
    this.name = name;
    this.preferredColor = preferredColor;
    this.closedByUs = false;
    this.open();
  }

  open() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    // location.host keeps whatever the player actually typed or scanned, so this works
    // unchanged on 127.0.0.1 for the host and on the hotspot IP for the guest.
    const url = `${scheme}://${location.host}/ws`;

    this.setLink('connecting');

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.retryDelay = 400;
      this.setLink('online');
      this.send({
        t: 'hello',
        token: playerToken(),
        name: this.name,
        color: this.preferredColor || null,
      });
    };

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      this.dispatch(msg);
    };

    socket.onclose = () => {
      this.socket = null;
      this.setLink('offline');
      if (!this.closedByUs) this.scheduleRetry();
    };

    socket.onerror = () => {
      // onclose always follows, which is where the retry is scheduled.
    };
  }

  dispatch(msg) {
    const h = this.handlers;
    switch (msg.t) {
      case 'welcome':
        if (h.onWelcome) h.onWelcome(msg);
        break;
      case 'state':
        if (h.onState) h.onState(msg.state);
        break;
      case 'clock':
        if (h.onClock) h.onClock(msg);
        break;
      case 'error':
        if (h.onServerError) h.onServerError(msg.message);
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }

  scheduleRetry() {
    if (this.retryTimer) return;
    // Fast retries: on a LAN the host is either there or it isn't, and a player staring at a
    // dead board does not want to wait 30 seconds to find out it came back.
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 3000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  /** Called when the app comes back to the foreground, to skip the backoff wait. */
  reconnectNow() {
    if (this.socket || this.closedByUs) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryDelay = 400;
    this.open();
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }

  setLink(state) {
    this.link = state;
    if (this.handlers.onLink) this.handlers.onLink(state);
  }

  close() {
    this.closedByUs = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) this.socket.close();
    this.socket = null;
  }
}
