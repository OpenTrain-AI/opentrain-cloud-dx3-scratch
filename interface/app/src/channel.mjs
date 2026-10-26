/**
 * @opentrain/channel-sdk — the widget channel (host <-> sandboxed widget
 * postMessage) with a declared compatibility window.
 *
 * Wire identity is the v1 pair `channel: { lineage, version }` in BOTH
 * directions (custom-components.js, ST-39 A-R-10). Channel v2 keeps it and
 * adds an envelope on every v2 message: the host's attempt token, a strictly
 * increasing sequence number and an idempotency key. A module declares the
 * versions it speaks in its app-manifest (`channel: {protocol, minVersion,
 * maxVersion}`, packages/contracts/src/work-contract/v1/app-manifest.json);
 * the host serves the highest version inside both windows and accepts, per
 * message, only the stamps inside the negotiated set.
 */

export const CHANNEL_PROTOCOL = 'opentrain.channel';
export const CHANNEL_LINEAGE = 'open-train-studio-widget';
/** Wire version (the integer stamped on messages) <-> manifest semver. */
export const CHANNEL_VERSIONS = Object.freeze([
  Object.freeze({ wire: 1, semver: '1.0.0' }),
  Object.freeze({ wire: 2, semver: '2.0.0' }),
]);
/** The versions this host serves. */
export const HOST_WINDOW = Object.freeze({
  protocol: CHANNEL_PROTOCOL,
  minVersion: '1.0.0',
  maxVersion: '2.0.0',
});
/** A widget with no manifest is a v1 widget: exactly v1, byte-identical SDK. */
export const LEGACY_WINDOW = Object.freeze({
  protocol: CHANNEL_PROTOCOL,
  minVersion: '1.0.0',
  maxVersion: '1.0.0',
});

// v1 bounds, unchanged (custom-components.js).
export const RESULTS_MAX_ENTRIES = 50;
export const RESULTS_MAX_BYTES = 262144;
export const MIN_HEIGHT = 80;
export const MAX_HEIGHT = 1600;
export const MESSAGE_BUDGET = Object.freeze({ windowMs: 10_000, maxMessages: 60 });
// v2 bounds.
export const DRAFT_MAX_BYTES = RESULTS_MAX_BYTES;
export const TEXT_MAX_BYTES = 4096;
export const ACTIVITY_MIN_INTERVAL_MS = 5000;
export const PRE_INIT_QUEUE_MAX = 64;
export const ACTIVITY_SIGNALS = Object.freeze(['READINESS', 'ACTIVITY', 'HEARTBEAT']);
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
export const CODE = /^[a-z][a-z0-9._-]{0,63}$/;
/**
 * P1 U1a: the two reserved ot:error codes of DATA-01. An app sends inputInvalid for a task whose
 * data is malformed and formatUnsupported for data its declared modality does not serve, with no
 * results. They ride the existing ot:error (no wire change; both match CODE), and a host treats
 * them as ordinary errors.
 */
export const DATA_ERROR_CODES = Object.freeze({
  inputInvalid: 'data.input_invalid',
  formatUnsupported: 'data.format_unsupported',
});
export const ATTEMPT = /^[A-Za-z0-9_-]{16,128}$/;
/** A4a-O4 PR M: a media handle, the task asset's id (ot:init's media list, ot:media.refresh). */
export const MEDIA_REF = /^[A-Za-z0-9_-]{1,128}$/;
/** ot:media.refresh carries the envelope and its ref, nothing else. */
const MEDIA_REFRESH_KEYS = new Set(['type', 'channel', 'attempt', 'seq', 'idempotencyKey', 'ref']);
/** A4b-O6 D6 C-g2: the longest endpoint an ot:network.token may name, in characters. */
export const NETWORK_ENDPOINT_MAX_LENGTH = 2048;
/** ot:network.token carries the envelope and its endpoint, nothing else. */
const NETWORK_TOKEN_KEYS = new Set([
  'type',
  'channel',
  'attempt',
  'seq',
  'idempotencyKey',
  'endpoint',
]);
/** FPC-A6.1 U4b-1: an app-data collection name and record key, the store's own rules (app-data.ts). */
export const DATA_COLLECTION = /^[a-z][a-z0-9_]{0,62}$/;
export const DATA_RECORD_KEY_MAX_LENGTH = 256;
/** The largest record an ot:data.put carries, in JSON bytes (the store refuses a larger one). */
export const DATA_RECORD_MAX_BYTES = 65536;
export const DATA_CURSOR_MAX_LENGTH = 512;
export const DATA_PAGE_MAX = 100;
const ENVELOPE_KEYS = ['type', 'channel', 'attempt', 'seq', 'idempotencyKey'];
/** Each ot:data.* call carries the envelope and its op's fields, nothing else. */
const DATA_KEYS = Object.freeze({
  get: new Set([...ENVELOPE_KEYS, 'collection', 'recordKey']),
  list: new Set([...ENVELOPE_KEYS, 'collection', 'cursor', 'limit']),
  put: new Set([...ENVELOPE_KEYS, 'collection', 'recordKey', 'data', 'expectedDataVersion']),
  delete: new Set([...ENVELOPE_KEYS, 'collection', 'recordKey', 'expectedDataVersion']),
});

// Exactly the contracts `semver` def (common.json): no build metadata.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value);
  if (!match) return null;
  const pre = match[4] === undefined ? [] : match[4].split('.');
  return { core: [match[1], match[2], match[3]].map(BigInt), pre };
}

/** SemVer 2.0 section 11 precedence; both arguments must parse. */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new TypeError('compareSemver: invalid version');
  for (let i = 0; i < 3; i += 1) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  // A release outranks its prereleases.
  if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i += 1) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pn && qn) return BigInt(p) < BigInt(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a declared window without trusting it; returns a reason string or null. */
function windowProblem(declared, label) {
  if (!isPlainObject(declared)) return `${label} is not an object`;
  if (declared.protocol !== CHANNEL_PROTOCOL) return `${label} protocol`;
  if (!parseSemver(declared.minVersion)) return `${label} minVersion`;
  if (!parseSemver(declared.maxVersion)) return `${label} maxVersion`;
  if (compareSemver(declared.minVersion, declared.maxVersion) > 0) return `${label} is empty`;
  return null;
}

const inside = (semver, w) =>
  compareSemver(w.minVersion, semver) <= 0 && compareSemver(semver, w.maxVersion) <= 0;

/**
 * Negotiates the declared window (a manifest's `channel`, or LEGACY_WINDOW
 * when the widget has no manifest) against the host's. Returns
 * `{ok: true, wire, versions, window}` — `wire` is the version the host
 * serves (the highest common one), `versions` every accepted stamp — or
 * `{ok: false, reason}`. Never throws on untrusted input.
 */
export function negotiateChannel(declared = LEGACY_WINDOW, host = HOST_WINDOW) {
  const problem = windowProblem(declared, 'declared window') ?? windowProblem(host, 'host window');
  if (problem) return { ok: false, reason: problem };
  const versions = CHANNEL_VERSIONS.filter(
    (v) => inside(v.semver, declared) && inside(v.semver, host)
  ).map((v) => v.wire);
  if (versions.length === 0) return { ok: false, reason: 'no common channel version' };
  return Object.freeze({
    ok: true,
    wire: versions[versions.length - 1],
    versions: Object.freeze(versions),
    window: Object.freeze({ minVersion: declared.minVersion, maxVersion: declared.maxVersion }),
  });
}

/** The stamp's wire version when it is this lineage and an accepted version, else null. */
export function stampVersion(value, versions) {
  if (!isPlainObject(value) || value.lineage !== CHANNEL_LINEAGE) return null;
  return versions.includes(value.version) ? value.version : null;
}

export const stamp = (version) => ({ lineage: CHANNEL_LINEAGE, version });

/**
 * Bounded, coercion-free description of an untrusted stamp (identical to
 * describeWidgetChannel: never calls the payload's toString/valueOf/toJSON).
 */
export function describeStamp(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'number' || kind === 'boolean') return `${kind} ${String(value)}`;
  if (kind === 'string') return `string ${JSON.stringify(value.slice(0, 64))}`;
  if (kind === 'object') {
    const { lineage, version } = value;
    const l = typeof lineage === 'string' ? lineage.slice(0, 64) : `<${typeof lineage}>`;
    const v =
      typeof version === 'number' || typeof version === 'string'
        ? String(version).slice(0, 16)
        : `<${typeof version}>`;
    return `${l}/${v}`;
  }
  return `<${kind}>`;
}

export const utf8ByteLength = (text) => new TextEncoder().encode(text).length;

/** JSON size in UTF-8 bytes, or null when the value does not serialize. */
export function jsonBytes(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  return typeof serialized === 'string' ? utf8ByteLength(serialized) : null;
}

export function validateResults(payload) {
  if (!Array.isArray(payload)) return null;
  if (payload.length === 0 || payload.length > RESULTS_MAX_ENTRIES) return null;
  const bytes = jsonBytes(payload);
  if (bytes === null || bytes > RESULTS_MAX_BYTES) return null;
  for (const entry of payload) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    if (typeof entry.from_name !== 'string' || !entry.from_name) return null;
    if (typeof entry.to_name !== 'string' || !entry.to_name) return null;
    if (typeof entry.type !== 'string' || !entry.type) return null;
    if (typeof entry.value !== 'object' || entry.value === null) return null;
  }
  return payload;
}

/** The own keys a relation row may carry, as the editor serializes a link between two regions. */
const RELATION_KEYS = new Set(['type', 'from_id', 'to_id', 'direction', 'labels']);
const RELATION_DIRECTIONS = new Set(['right', 'left', 'bi']);
const isStringList = (value) =>
  Array.isArray(value) &&
  Object.keys(value).length === value.length &&
  value.every((item) => typeof item === 'string');

/**
 * The native app port's results rule (manager 91178, security read 91446): what
 * validateResults accepts, and also a payload whose relation rows, {type:
 * 'relation', from_id, to_id} with an optional direction and labels, each name
 * by id two non-relation rows of the same payload. Every other row passes
 * validateResults, at least one is present, and the entry and byte bounds are
 * validateResults' own. A dangling, relations-only or extra-key relation is
 * refused. Only a host created with `relations: true` uses it.
 */
function validatePortResults(payload) {
  const plain = validateResults(payload);
  if (plain !== null) return plain;
  if (!Array.isArray(payload) || payload.length > RESULTS_MAX_ENTRIES) return null;
  const relations = payload.filter((entry) => isPlainObject(entry) && entry.type === 'relation');
  const rows = payload.filter((entry) => !relations.includes(entry));
  if (relations.length === 0 || rows.length === 0) return null;
  const bytes = jsonBytes(payload);
  if (bytes === null || bytes > RESULTS_MAX_BYTES || validateResults(rows) === null) return null;
  const ids = new Set(rows.map((row) => row.id).filter((id) => typeof id === 'string' && id));
  for (const relation of relations) {
    if (!Object.keys(relation).every((key) => RELATION_KEYS.has(key))) return null;
    if (!ids.has(relation.from_id) || !ids.has(relation.to_id)) return null;
    if (relation.direction !== undefined && !RELATION_DIRECTIONS.has(relation.direction))
      return null;
    if (relation.labels !== undefined && !isStringList(relation.labels)) return null;
  }
  return payload;
}

export const isHeightRequest = (px) => typeof px === 'number' && Number.isFinite(px);

export function clampHeight(px) {
  if (!isHeightRequest(px)) return MIN_HEIGHT;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px)));
}

/** The v1 payload rules shared by both versions: results and height. */
function classifyV1Payload(data) {
  if (data.type === 'ot:height') {
    return isHeightRequest(data.px)
      ? { kind: 'height', px: clampHeight(data.px) }
      : { kind: 'invalid', reason: 'ot:height px' };
  }
  if (data.type === 'ot:results') {
    const results = validateResults(data.results);
    return results
      ? { kind: 'results', results }
      : { kind: 'invalid', reason: 'ot:results payload' };
  }
  return null;
}

const unknownType = (data) => ({
  kind: 'unknown-type',
  type: typeof data.type === 'string' ? data.type.slice(0, 64) : null,
});

/**
 * Channel v1 classification, identical to the editor's classifyWidgetMessage
 * (the v1-compat test proves it differentially).
 */
export function classifyV1Message(data) {
  if (!data || typeof data !== 'object') return { kind: 'invalid', reason: 'not an object' };
  if (stampVersion(data.channel, [1]) === null) {
    return { kind: 'unsupported-channel', channel: describeStamp(data.channel) };
  }
  return classifyV1Payload(data) ?? unknownType(data);
}

const boundedText = (value) =>
  typeof value === 'string' && value.length > 0 && utf8ByteLength(value) <= TEXT_MAX_BYTES;

const isDataVersion = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * FPC-A6.1 U4b-1: one ot:data.* call, `ot:data.<op>` with exactly its op's
 * fields (the envelope keys may be absent: the port SDK checks a call before
 * it posts). Returns the request the shell posts to the attempt's app-data
 * route, `{op, collection, ...}`, or the first field that fails.
 */
export function classifyDataRequest(data) {
  const op =
    typeof data?.type === 'string' && data.type.startsWith('ot:data.') ? data.type.slice(8) : null;
  if (!Object.hasOwn(DATA_KEYS, op)) return { ok: false, field: 'type' };
  const extra = Object.keys(data).find((key) => !DATA_KEYS[op].has(key));
  if (extra !== undefined) return { ok: false, field: 'keys' };
  if (!(typeof data.collection === 'string' && DATA_COLLECTION.test(data.collection))) {
    return { ok: false, field: 'collection' };
  }
  const request = { op, collection: data.collection };
  if (op !== 'list') {
    const key = data.recordKey;
    if (
      !(
        typeof key === 'string' &&
        key.length > 0 &&
        key.length <= DATA_RECORD_KEY_MAX_LENGTH &&
        !/[\u0000-\u001f]/u.test(key) &&
        // a URL resolves a dot-only segment, so the public API could never address it
        key !== '.' &&
        key !== '..'
      )
    ) {
      return { ok: false, field: 'recordKey' };
    }
    request.recordKey = key;
  }
  if (op === 'list') {
    if (data.cursor !== undefined) {
      if (!(typeof data.cursor === 'string' && data.cursor.length <= DATA_CURSOR_MAX_LENGTH)) {
        return { ok: false, field: 'cursor' };
      }
      request.cursor = data.cursor;
    }
    if (data.limit !== undefined) {
      if (!(Number.isSafeInteger(data.limit) && data.limit >= 1 && data.limit <= DATA_PAGE_MAX)) {
        return { ok: false, field: 'limit' };
      }
      request.limit = data.limit;
    }
  }
  if (op === 'put') {
    const bytes = data.data === undefined ? null : jsonBytes(data.data);
    if (bytes === null || bytes > DATA_RECORD_MAX_BYTES) return { ok: false, field: 'data' };
    request.data = data.data;
  }
  if (data.expectedDataVersion !== undefined) {
    if (!isDataVersion(data.expectedDataVersion))
      return { ok: false, field: 'expectedDataVersion' };
    request.expectedDataVersion = data.expectedDataVersion;
  }
  return { ok: true, request };
}

/**
 * The v2 payload rules, after the envelope has been checked. Bundle signals
 * are evidence only (T12/T13, BF-24): the host records them, never grades
 * or pays on them. With `relations` (the native app port only) ot:results
 * also takes relation rows (validatePortResults); without it, as on every
 * widget host, results keep the v1 rule.
 */
export function classifyV2Payload(data, { relations = false } = {}) {
  if (relations === true && data.type === 'ot:results') {
    const results = validatePortResults(data.results);
    return results
      ? { kind: 'results', results }
      : { kind: 'invalid', reason: 'ot:results payload' };
  }
  const v1 = classifyV1Payload(data);
  if (v1) return v1;
  switch (data.type) {
    case 'ot:activity':
      return ACTIVITY_SIGNALS.includes(data.signal)
        ? {
            kind: 'activity',
            observation: { class: 'BUNDLE', signal: data.signal },
            evidenceOnly: true,
          }
        : { kind: 'invalid', reason: 'ot:activity signal' };
    case 'ot:draft': {
      if (data.replyTo !== undefined && !Number.isSafeInteger(data.replyTo)) {
        return { kind: 'invalid', reason: 'ot:draft replyTo' };
      }
      const bytes = data.draft === undefined ? null : jsonBytes(data.draft);
      return bytes === null || bytes > DRAFT_MAX_BYTES
        ? { kind: 'invalid', reason: 'ot:draft payload' }
        : { kind: 'draft', draft: data.draft, replyTo: data.replyTo ?? null };
    }
    case 'ot:help':
      if (!boundedText(data.message)) return { kind: 'invalid', reason: 'ot:help message' };
      if (data.topic !== undefined && !(typeof data.topic === 'string' && CODE.test(data.topic))) {
        return { kind: 'invalid', reason: 'ot:help topic' };
      }
      return { kind: 'help', topic: data.topic ?? null, message: data.message };
    case 'ot:error':
      if (!(typeof data.code === 'string' && CODE.test(data.code))) {
        return { kind: 'invalid', reason: 'ot:error code' };
      }
      if (data.message !== undefined && !boundedText(data.message)) {
        return { kind: 'invalid', reason: 'ot:error message' };
      }
      return { kind: 'error', code: data.code, message: data.message ?? null };
    case 'ot:media.refresh':
      // A4a-O4 PR M: the app asks the shell for a media grant for one of its init's handles.
      if (!Object.keys(data).every((key) => MEDIA_REFRESH_KEYS.has(key))) {
        return { kind: 'invalid', reason: 'ot:media.refresh keys' };
      }
      return typeof data.ref === 'string' && MEDIA_REF.test(data.ref)
        ? { kind: 'media-refresh', ref: data.ref }
        : { kind: 'invalid', reason: 'ot:media.refresh ref' };
    case 'ot:network.token':
      // A4b-O6 D6 C-g2: the app asks the shell for a private-access token for one endpoint.
      if (!Object.keys(data).every((key) => NETWORK_TOKEN_KEYS.has(key))) {
        return { kind: 'invalid', reason: 'ot:network.token keys' };
      }
      return typeof data.endpoint === 'string' &&
        data.endpoint.length > 0 &&
        data.endpoint.length <= NETWORK_ENDPOINT_MAX_LENGTH
        ? { kind: 'network-token', endpoint: data.endpoint }
        : { kind: 'invalid', reason: 'ot:network.token endpoint' };
    case 'ot:data.get':
    case 'ot:data.list':
    case 'ot:data.put':
    case 'ot:data.delete': {
      // FPC-A6.1 U4b-1: the app reads or writes its own installation's data through the shell.
      const call = classifyDataRequest(data);
      return call.ok
        ? { kind: 'data', request: call.request }
        : { kind: 'invalid', reason: `${data.type} ${call.field}` };
    }
    default:
      return unknownType(data);
  }
}
