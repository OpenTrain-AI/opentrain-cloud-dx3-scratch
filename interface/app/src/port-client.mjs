import {
  ACTIVITY_MIN_INTERVAL_MS,
  PRE_INIT_QUEUE_MAX,
  classifyDataRequest,
  stamp,
} from './channel.mjs';

/** P1 U1a: the reserved ot:error codes of DATA-01, for reportError (see channel.mjs). */
export { DATA_ERROR_CODES } from './channel.mjs';

const CHANNEL = Object.freeze(stamp(2));
/** A4a-O4 PR M: a media URL with less than this left is refreshed before use. */
export const MEDIA_REFRESH_MARGIN_MS = 60_000;
/** A media request the shell has not answered in this long is rejected 'media.timeout'. */
export const MEDIA_REQUEST_TIMEOUT_MS = 30_000;
/** attach() retries a retryable refusal after this long, doubling each time up to MEDIA_RETRY_MAX_MS. */
export const MEDIA_RETRY_MIN_MS = 2_000;
export const MEDIA_RETRY_MAX_MS = 30_000;
/**
 * The codes attach() retries: the media is being promoted (shell.media_pending), the
 * shell could not ask (media.unavailable), or no answer came (media.timeout). Any other
 * code is terminal: the ref is not the task's, the media can never be served, or the
 * channel closed.
 */
export const MEDIA_RETRYABLE_CODES = Object.freeze([
  'shell.media_pending',
  'media.unavailable',
  'media.timeout',
]);
const MEDIA_RETRYABLE = new Set(MEDIA_RETRYABLE_CODES);
/** A4b-O6 D6 C-g2: a network token request unanswered this long is rejected 'network.timeout'. */
export const NETWORK_REQUEST_TIMEOUT_MS = 30_000;
/** FPC-A6.1 U4b-1: an app-data call the shell has not answered in this long is rejected 'app_data.timeout'. */
export const DATA_REQUEST_TIMEOUT_MS = 30_000;

/**
 * A4a-O4 PR 3c (contract 36770, ORCH-O 36789): the channel v2 SDK over a
 * MessagePort, for a signed app in a gateway frame. Its only channel to the
 * shell is the port the gateway's bootstrap transfers
 * (services/ot-bundle-gateway/src/port-bootstrap.mjs), and the shell's
 * createAppPortHost (port-host.mjs) listens on that port only.
 *
 * The API, the envelope and the inbound checks are wire-2 window.OpenTrain's
 * (buildWidgetSdkScript(2) in widget-sdk.mjs), with the transport swapped:
 * - It listens and posts on the port ONLY, never on the window or a parent,
 *   and starts the port after adding its listener. A port has one
 *   counterpart, so the srcdoc SDK's source check is structural here.
 * - Every outbound message carries the v2 stamp, the attempt bound by the
 *   first valid ot:init, a strictly increasing seq (resumed after the init's
 *   lastSeq) and an idempotency key ('w:' + seq, or opts.idempotencyKey for a
 *   retry). Messages sent before init wait in a queue of PRE_INIT_QUEUE_MAX
 *   and go out in order once init binds the attempt.
 * - Inbound, only a v2-stamped message with the bound attempt and a seq above
 *   the last host seq is read: ot:init, and ot:draft with request: true. State
 *   is committed before a callback runs.
 * - reportActivity keeps the srcdoc SDK's slot rule; sendResults is neither
 *   throttled nor coalesced: the shell submits the task on each send, so an
 *   app sends results once, at its commit point (see the README).
 * - close() removes the listener and closes the port; after it every method
 *   is a no-op and reportActivity returns false.
 * - Media (A4a-O4 PR M; contract 48402 adopting 48374 (C)): `media.handles()`
 *   is init's list of the task's media, [{ref, contentType}].
 *   `media.url(ref)` resolves {url, exp} (exp in epoch seconds) from the
 *   shell's ot:media.grant, asking with ot:media.refresh unless a URL with
 *   more than MEDIA_REFRESH_MARGIN_MS left is held; concurrent asks for one
 *   ref share one request. It rejects with the shell's code (ot:media.refused)
 *   or 'media.timeout'. `media.attach(element, ref)` sets the element's src
 *   and, MEDIA_REFRESH_MARGIN_MS before each expiry, swaps in a fresh URL. A
 *   retryable refusal (MEDIA_RETRYABLE_CODES: the first open of a task whose
 *   media is still being promoted, a timeout, the shell unable to ask) is
 *   retried with backoff (MEDIA_RETRY_MIN_MS doubling to MEDIA_RETRY_MAX_MS)
 *   while attached; a terminal code goes to onError and stops it. Each swap
 *   keeps a playing element's currentTime and paused state: playback
 *   continues across a refresh.
 * - App data (FPC-A6.1 U4b-1): `data.get/list/put/delete` each send one
 *   ot:data.<op> and settle on the shell's ot:data.result or ot:data.refused
 *   whose replyTo is that message's seq (a call made before init is matched
 *   once the queue sends it). A call the channel's rules refuse
 *   (classifyDataRequest) is rejected 'app_data.invalid' and never sent.
 */
export function createPortChannel({ port, now = Date.now } = {}) {
  if (
    !port ||
    typeof port.postMessage !== 'function' ||
    typeof port.addEventListener !== 'function' ||
    typeof port.close !== 'function'
  ) {
    throw new TypeError('createPortChannel: port must be a MessagePort');
  }
  if (typeof now !== 'function') throw new TypeError('createPortChannel: now must be a function');
  let attempt = null;
  let seq = 0;
  let hostSeq = 0;
  let payload = null;
  let queue = [];
  let initCb = null;
  let draftCb = null;
  let readySent = false;
  let lastActivity = -Infinity;
  let lastSignal = null;
  let closed = false;
  let mediaHandles = [];
  const mediaHeld = new Map();
  const mediaWaiters = new Map();
  const networkWaiters = new Map();
  /** Sent app-data calls by their message's seq. */
  const dataWaiters = new Map();
  /** App-data calls still in the pre-init queue. */
  const dataQueued = new Set();

  const pair = () => ({ lineage: CHANNEL.lineage, version: CHANNEL.version });
  const supported = (c) =>
    !!c && typeof c === 'object' && c.lineage === CHANNEL.lineage && c.version === CHANNEL.version;

  /** `sent(seq)` runs once the message goes out (an app-data call matches its answer by that seq). */
  function post(message, opts, sent) {
    if (closed) return false;
    if (attempt === null) {
      if (queue.length >= PRE_INIT_QUEUE_MAX) return false;
      queue.push([message, opts, sent]);
      return true;
    }
    seq += 1;
    message.channel = pair();
    message.attempt = attempt;
    message.seq = seq;
    message.idempotencyKey =
      opts && typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : `w:${seq}`;
    port.postMessage(message);
    sent?.(seq);
    return true;
  }

  function onMessage(event) {
    if (closed) return;
    const data = event?.data;
    if (!data || typeof data !== 'object' || !supported(data.channel)) return;
    if (typeof data.attempt !== 'string' || (attempt !== null && data.attempt !== attempt)) return;
    if (typeof data.seq !== 'number' || !(data.seq > hostSeq)) return;
    if (data.type === 'ot:init') {
      hostSeq = data.seq;
      if (attempt === null) {
        attempt = data.attempt;
        if (typeof data.lastSeq === 'number' && data.lastSeq > seq) seq = data.lastSeq;
      }
      payload = {
        taskData: data.taskData,
        params: data.params,
        channel: pair(),
        draft: data.draft === undefined ? null : data.draft,
        // A4a-O5-SWAP-FOCUS-001: only when the shell handed this frame keyboard focus, so
        // every other payload stays exactly the srcdoc SDK's (the C1 parity cell).
        ...(data.focus === true ? { focus: true } : {}),
        // P1 U2-P: only when the task was served beside the worker's own live submission.
        ...(Array.isArray(data.submitted) ? { submitted: data.submitted } : {}),
      };
      mediaHandles = Array.isArray(data.media) ? data.media : [];
      const pending = queue;
      queue = [];
      for (const [message, opts, sent] of pending) post(message, opts, sent);
      if (initCb) initCb(payload);
      return;
    }
    if (attempt !== null && (data.type === 'ot:media.grant' || data.type === 'ot:media.refused')) {
      hostSeq = data.seq;
      settleMedia(data);
      return;
    }
    if (
      attempt !== null &&
      (data.type === 'ot:network.grant' || data.type === 'ot:network.refused')
    ) {
      hostSeq = data.seq;
      settleNetwork(data);
      return;
    }
    if (attempt !== null && (data.type === 'ot:data.result' || data.type === 'ot:data.refused')) {
      hostSeq = data.seq;
      settleData(data);
      return;
    }
    if (attempt === null || data.type !== 'ot:draft' || data.request !== true) return;
    hostSeq = data.seq;
    if (!draftCb) return;
    const draft = draftCb();
    if (draft !== undefined) post({ type: 'ot:draft', draft, replyTo: data.seq });
  }

  function settleMedia(data) {
    if (typeof data.ref !== 'string') return;
    const waiters = mediaWaiters.get(data.ref);
    if (data.type === 'ot:media.grant') {
      if (typeof data.url !== 'string' || !Number.isSafeInteger(data.exp)) return;
      mediaHeld.set(data.ref, { url: data.url, exp: data.exp });
    }
    if (!waiters) return;
    mediaWaiters.delete(data.ref);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (data.type === 'ot:media.grant') waiter.resolve({ url: data.url, exp: data.exp });
      else waiter.reject(new Error(typeof data.code === 'string' ? data.code : 'media.refused'));
    }
  }

  function settleNetwork(data) {
    if (typeof data.endpoint !== 'string') return;
    const grant = data.type === 'ot:network.grant';
    const whole =
      typeof data.token === 'string' &&
      typeof data.url === 'string' &&
      typeof data.expiresAt === 'string';
    if (grant && !whole) return;
    const waiters = networkWaiters.get(data.endpoint);
    if (!waiters) return;
    networkWaiters.delete(data.endpoint);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (grant) waiter.resolve({ token: data.token, url: data.url, expiresAt: data.expiresAt });
      else waiter.reject(new Error(typeof data.code === 'string' ? data.code : 'network.refused'));
    }
  }

  function settleData(data) {
    const waiter = Number.isSafeInteger(data.replyTo) ? dataWaiters.get(data.replyTo) : undefined;
    if (!waiter || data.op !== waiter.op) return;
    const result = data.type === 'ot:data.result';
    if (result && !(typeof data.result === 'object' && data.result !== null)) return;
    dataWaiters.delete(data.replyTo);
    clearTimeout(waiter.timer);
    if (result) return waiter.resolve(data.result);
    const error = new Error(typeof data.code === 'string' ? data.code : 'app_data.refused');
    if (Number.isSafeInteger(data.retryAfterSeconds))
      error.retryAfterSeconds = data.retryAfterSeconds;
    waiter.reject(error);
  }

  /**
   * FPC-A6.1 U4b-1: one call on the app's own installation data. It resolves the shell's
   * answer (the app-data route's acceptance) and rejects with the shell's code
   * (ot:data.refused; an upgrade's 'upgrade_in_progress' carries retryAfterSeconds),
   * 'app_data.invalid', 'app_data.timeout' or 'app_data.closed'.
   */
  function dataCall(message) {
    if (closed) return Promise.reject(new Error('app_data.closed'));
    if (!classifyDataRequest(message).ok) return Promise.reject(new Error('app_data.invalid'));
    return new Promise((resolve, reject) => {
      const waiter = { op: message.type.slice(8), resolve, reject, timer: null, seq: null };
      waiter.timer = setTimeout(() => {
        dataQueued.delete(waiter);
        if (waiter.seq !== null) dataWaiters.delete(waiter.seq);
        waiter.seq = -1;
        reject(new Error('app_data.timeout'));
      }, DATA_REQUEST_TIMEOUT_MS);
      dataQueued.add(waiter);
      const posted = post(message, undefined, (sentSeq) => {
        dataQueued.delete(waiter);
        // A call that timed out in the queue goes out unanswered: nothing waits for it.
        if (waiter.seq === -1) return;
        waiter.seq = sentSeq;
        dataWaiters.set(sentSeq, waiter);
      });
      if (!posted) {
        clearTimeout(waiter.timer);
        dataQueued.delete(waiter);
        reject(new Error(closed ? 'app_data.closed' : 'app_data.queue_full'));
      }
    });
  }

  const withOptional = (message, key, value) => {
    if (value !== undefined) message[key] = value;
    return message;
  };

  function mediaUrl(ref) {
    if (closed) return Promise.reject(new Error('media.closed'));
    const held = mediaHeld.get(ref);
    if (held && held.exp * 1000 - now() > MEDIA_REFRESH_MARGIN_MS) return Promise.resolve(held);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const list = mediaWaiters.get(ref);
        if (list) {
          const rest = list.filter((item) => item !== waiter);
          if (rest.length > 0) mediaWaiters.set(ref, rest);
          else mediaWaiters.delete(ref);
        }
        reject(new Error('media.timeout'));
      }, MEDIA_REQUEST_TIMEOUT_MS);
      const list = mediaWaiters.get(ref);
      if (list) return void list.push(waiter);
      mediaWaiters.set(ref, [waiter]);
      post({ type: 'ot:media.refresh', ref });
    });
  }

  /**
   * A4b-O6 D6 C-g2: a private-access token for one endpoint the app's version declares. It
   * asks with ot:network.token {endpoint}, and concurrent asks for one endpoint share one
   * request. It resolves {token, url, expiresAt} from the shell's ot:network.grant: present
   * the token to `url` (the endpoint itself, or the connector relay's route to it) until
   * expiresAt. It rejects with the shell's code (ot:network.refused), 'network.timeout' or
   * 'network.closed'. Each call is one channel message: keep the token until near its expiry.
   */
  function networkToken(endpoint) {
    if (closed) return Promise.reject(new Error('network.closed'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const list = networkWaiters.get(endpoint);
        if (list) {
          const rest = list.filter((item) => item !== waiter);
          if (rest.length > 0) networkWaiters.set(endpoint, rest);
          else networkWaiters.delete(endpoint);
        }
        reject(new Error('network.timeout'));
      }, NETWORK_REQUEST_TIMEOUT_MS);
      const list = networkWaiters.get(endpoint);
      if (list) return void list.push(waiter);
      networkWaiters.set(endpoint, [waiter]);
      post({ type: 'ot:network.token', endpoint });
    });
  }

  function attachMedia(element, ref, { onError } = {}) {
    let active = true;
    let timer = null;
    let failures = 0;
    let settle;
    let fail;
    const ready = new Promise((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const report = (error) => {
      if (active && typeof onError === 'function') onError(error);
    };
    const schedule = (exp) => {
      const delay = Math.max(1000, exp * 1000 - now() - MEDIA_REFRESH_MARGIN_MS);
      timer = setTimeout(() => attempt(false), delay);
    };
    async function swap(first) {
      const grant = await mediaUrl(ref);
      if (!active) return grant;
      if (first || !('currentTime' in element)) {
        element.src = grant.url;
      } else {
        // The same object under a fresh grant: playback continues where it was.
        const position = element.currentTime;
        const paused = element.paused;
        const resume = () => {
          element.removeEventListener('loadedmetadata', resume);
          try {
            element.currentTime = position;
          } catch {
            // A media element not seekable yet keeps its start.
          }
          if (!paused) element.play?.()?.catch?.(() => undefined);
        };
        element.addEventListener('loadedmetadata', resume);
        element.src = grant.url;
      }
      schedule(grant.exp);
      return grant;
    }
    // The first open and every refresh: a retryable refusal is asked again with backoff
    // while attached (a refresh keeps the position it had); a terminal one is reported.
    function attempt(first) {
      swap(first).then(
        (grant) => {
          failures = 0;
          if (first) settle(grant);
        },
        (error) => {
          if (!active) return;
          const code = error instanceof Error ? error.message : String(error);
          if (MEDIA_RETRYABLE.has(code)) {
            const delay = Math.min(MEDIA_RETRY_MAX_MS, MEDIA_RETRY_MIN_MS * 2 ** failures);
            failures += 1;
            timer = setTimeout(() => attempt(first), delay);
            return;
          }
          report(error);
          if (first) fail(error);
        }
      );
    }
    ready.catch(() => undefined);
    attempt(true);
    return Object.freeze({
      ready,
      detach() {
        active = false;
        clearTimeout(timer);
      },
    });
  }

  port.addEventListener('message', onMessage);
  port.start?.();

  return Object.freeze({
    /** The widget channel this SDK speaks: {lineage, version}. */
    channel: Object.freeze(pair()),
    /**
     * Registers the callback that receives {taskData, params, channel, draft} once the host
     * inits, plus focus: true when the shell handed this frame keyboard focus (a renewal
     * replaced the frame the worker was typing in): focus the control the worker was in.
     * It also receives submitted, the rows of the worker's own live submission, when the task
     * is served beside one (rework, an owner reopen): rebuild the prior answer from it.
     */
    init(cb) {
      if (closed) return;
      initCb = cb;
      if (payload) cb(payload);
    },
    /** Sends LS-format results (validated host-side). The shell submits them: send once. */
    sendResults(results, opts) {
      post({ type: 'ot:results', results }, opts);
    },
    /** Requests a frame height (clamped host-side). */
    setHeight(px, opts) {
      post({ type: 'ot:height', px }, opts);
    },
    /** READINESS once; ACTIVITY and HEARTBEAT share one slot, and an ACTIVITY replaces a HEARTBEAT. */
    reportActivity(signal) {
      if (closed) return false;
      if (signal === 'READINESS') {
        if (readySent) return false;
        readySent = true;
      } else {
        const at = now();
        if (
          at - lastActivity < ACTIVITY_MIN_INTERVAL_MS &&
          !(signal === 'ACTIVITY' && lastSignal === 'HEARTBEAT')
        )
          return false;
        lastActivity = at;
        lastSignal = signal;
      }
      post({ type: 'ot:activity', signal });
      return true;
    },
    /** Sends a draft; the shell saves it at the frame's version. */
    saveDraft(draft, opts) {
      post({ type: 'ot:draft', draft }, opts);
    },
    /** Registers the callback that answers the shell's draft request (undefined sends nothing). */
    onDraftRequest(cb) {
      if (closed) return;
      draftCb = cb;
    },
    requestHelp(message, topic) {
      const m = { type: 'ot:help', message };
      if (topic !== undefined) m.topic = topic;
      post(m);
    },
    reportError(code, message) {
      const m = { type: 'ot:error', code };
      if (message !== undefined) m.message = message;
      post(m);
    },
    /** A4a-O4 PR M: the task's media (see the module comment). */
    media: Object.freeze({
      handles: () => mediaHandles,
      url: (ref) => mediaUrl(ref),
      attach: (element, ref, opts) => attachMedia(element, ref, opts),
    }),
    /** A4b-O6 D6 C-g2: private-network access (see networkToken). */
    network: Object.freeze({
      token: (endpoint) => networkToken(endpoint),
    }),
    /** FPC-A6.1 U4b-1: the app's own installation data (see dataCall). */
    data: Object.freeze({
      get: (collection, recordKey) => dataCall({ type: 'ot:data.get', collection, recordKey }),
      list: (collection, { cursor, limit } = {}) =>
        dataCall(
          withOptional(
            withOptional({ type: 'ot:data.list', collection }, 'cursor', cursor),
            'limit',
            limit
          )
        ),
      put: (collection, recordKey, data, { expectedDataVersion } = {}) =>
        dataCall(
          withOptional(
            { type: 'ot:data.put', collection, recordKey, data },
            'expectedDataVersion',
            expectedDataVersion
          )
        ),
      delete: (collection, recordKey, { expectedDataVersion } = {}) =>
        dataCall(
          withOptional(
            { type: 'ot:data.delete', collection, recordKey },
            'expectedDataVersion',
            expectedDataVersion
          )
        ),
    }),
    /** Removes the listener and closes the port; nothing is sent or read after it. */
    close() {
      if (closed) return;
      closed = true;
      queue = [];
      for (const waiters of mediaWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error('media.closed'));
        }
      }
      mediaWaiters.clear();
      for (const waiters of networkWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error('network.closed'));
        }
      }
      networkWaiters.clear();
      for (const waiter of [...dataWaiters.values(), ...dataQueued]) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('app_data.closed'));
      }
      dataWaiters.clear();
      dataQueued.clear();
      port.removeEventListener?.('message', onMessage);
      try {
        port.close();
      } catch {
        // Already closed.
      }
    },
  });
}
