import { getFirebaseServices } from '../lib/firebase-admin.mjs';

const STATUSES = new Set(['closed', 'tp_hit', 'sl_hit']);
const MAX_BODY = 4096;
class SignalError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}
function payload(req) {
  let data = req.body;
  if (typeof data === 'string') {
    if (data.length > MAX_BODY) throw new SignalError(413, 'request_too_large');
    try { data = JSON.parse(data); } catch { throw new SignalError(400, 'invalid_json'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > MAX_BODY) {
    throw new SignalError(400, 'invalid_request');
  }
  return data;
}
function only(data, fields) {
  if (Object.keys(data).some(k => !fields.includes(k))) throw new SignalError(400, 'invalid_fields');
}
function optionalText(value, length = 100) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.trim().length > length) throw new SignalError(422, 'invalid_text');
  return value.trim();
}
function signalLabel(signal) { return `XAUUSD ${signal.side.toUpperCase()}`; }
function signalBody(signal) {
  return [signal.entry && `Entrée : ${signal.entry}`, signal.tp && `TP : ${signal.tp}`,
    signal.sl && `SL : ${signal.sl}`, signal.message].filter(Boolean).join(' | ').slice(0, 1400)
    || 'Nouveau signal disponible dans votre espace VIP.';
}
async function admin(req, getServices) {
  const bearer = req.headers?.authorization;
  if (typeof bearer !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(bearer)) {
    throw new SignalError(401, 'authentication_required');
  }
  let services;
  try { services = await getServices(); }
  catch { throw new SignalError(503, 'firebase_unavailable'); }
  let user;
  try { user = await services.auth.verifyIdToken(bearer.slice(7), true); }
  catch { throw new SignalError(401, 'invalid_authentication'); }
  if (!user || user.admin !== true) throw new SignalError(403, 'administrator_required');
  return { services, user };
}
export function createSignalHandler({ getServices = getFirebaseServices } = {}) {
  return async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'PATCH') {
      res.setHeader('Allow', 'POST, PATCH');
      return send(res, 405, { error: 'method_not_allowed' });
    }
    try {
      const data = payload(req);
      const { services, user } = await admin(req, getServices);
      if (req.method === 'POST') {
        only(data, ['side', 'entry', 'tp', 'sl', 'message']);
        if (!['buy', 'sell'].includes(data.side)) throw new SignalError(422, 'invalid_direction');
        const signal = {
          symbol: 'XAUUSD', side: data.side,
          entry: optionalText(data.entry, 100), tp: optionalText(data.tp, 100),
          sl: optionalText(data.sl, 100), message: optionalText(data.message, 1000),
        };
        const ref = services.db.collection('signals').doc();
        const event = services.db.collection('signalPushEvents').doc();
        const batch = services.db.batch();
        batch.create(ref, {
          ...signal, status: 'open', createdAt: services.serverTimestamp(),
          createdBy: user.uid, updatedAt: services.serverTimestamp(),
          updatedBy: user.uid, closedAt: null, closeNote: '', lastEventId: event.id,
        });
        batch.create(event, {
          signalId: ref.id, eventType: 'created',
          title: `🔔 ${signalLabel(signal)} — Nouveau signal`,
          body: signalBody(signal), createdAt: services.serverTimestamp(), createdBy: user.uid,
        });
        await batch.commit();
        return send(res, 201, { signalId: ref.id, eventId: event.id });
      }
      only(data, ['signalId', 'status', 'closeNote']);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(data.signalId || '') || !STATUSES.has(data.status)) {
        throw new SignalError(422, 'invalid_status');
      }
      const closeNote = optionalText(data.closeNote, 500);
      const ref = services.db.collection('signals').doc(data.signalId);
      const event = services.db.collection('signalPushEvents').doc();
      await services.db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) throw new SignalError(404, 'signal_not_found');
        const signal = current.data();
        if (signal.status !== 'open') throw new SignalError(409, 'already_finalized');
        const statusText = data.status === 'tp_hit' ? 'TP atteint' :
          data.status === 'sl_hit' ? 'SL atteint' : 'Clôturé';
        tx.update(ref, {
          status: data.status, closeNote, closedAt: services.serverTimestamp(),
          updatedAt: services.serverTimestamp(), updatedBy: user.uid, lastEventId: event.id,
        });
        tx.create(event, {
          signalId: ref.id, eventType: data.status,
          title: `${signalLabel(signal)} — ${statusText}`,
          body: (closeNote || `Signal ${statusText.toLowerCase()} manuellement par l’administrateur.`).slice(0, 1400),
          createdAt: services.serverTimestamp(), createdBy: user.uid,
        });
      });
      return send(res, 200, { signalId: ref.id, eventId: event.id });
    } catch (error) {
      return send(res, error instanceof SignalError ? error.status : 503, {
        error: error instanceof SignalError ? error.code : 'signal_unavailable',
      });
    }
  };
}
export default createSignalHandler();
