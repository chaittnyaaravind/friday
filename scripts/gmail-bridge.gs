/**
 * FRIDAY Gmail bridge — runs in YOUR Google account (script.google.com), every 5 minutes.
 *
 *  1. Finds Handshake job-alert emails in your inbox and posts them to FRIDAY (your own mail; FRIDAY never visits Handshake).
 *  2. Asks FRIDAY for applications YOU approved in Telegram and sends each one from your Gmail, with your tailored resume
 *     attached, then tells FRIDAY it was sent (so the tracker shows "applied" and you get a confirmation).
 *
 * It only ever sends what FRIDAY's outbox holds, and the outbox only holds what you approved.
 *
 * Setup (once): paste this file into a new Apps Script project → Project Settings → Script properties:
 *     FRIDAY_URL    https://friday-roan.vercel.app
 *     FRIDAY_TOKEN  (FRIDAY → Settings → Auto Hunter → "Connect Gmail" — shown once)
 * then run `setup` once and allow access. To stop: run `teardown`, or disconnect in FRIDAY.
 */

var HANDSHAKE_QUERY = 'from:(joinhandshake.com) newer_than:2d';
var SEEN_KEY = 'friday_seen_ids';

function setup() {
  teardown();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  tick();
}

function teardown() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
}

function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still going
  try {
    postHandshakeAlerts_();
    sendApproved_();
  } finally {
    lock.releaseLock();
  }
}

function cfg_() {
  var p = PropertiesService.getScriptProperties();
  var url = (p.getProperty('FRIDAY_URL') || '').replace(/\/+$/, '');
  var token = p.getProperty('FRIDAY_TOKEN') || '';
  if (!url || !token) throw new Error('Set FRIDAY_URL and FRIDAY_TOKEN in Script properties.');
  return { url: url, token: token };
}

function call_(method, path, payload) {
  var c = cfg_();
  var res = UrlFetchApp.fetch(c.url + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + c.token },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 401) throw new Error('FRIDAY rejected the token. Reconnect Gmail in FRIDAY → Settings and update FRIDAY_TOKEN.');
  if (code >= 300) throw new Error('FRIDAY ' + path + ' answered ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

function postHandshakeAlerts_() {
  var props = PropertiesService.getUserProperties();
  var seen = JSON.parse(props.getProperty(SEEN_KEY) || '[]');
  var batch = [];
  GmailApp.search(HANDSHAKE_QUERY, 0, 20).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      var id = m.getId();
      if (seen.indexOf(id) >= 0 || batch.length >= 20) return;
      batch.push({ id: id, from: m.getFrom(), receivedAt: m.getDate().toISOString(), html: m.getBody().slice(0, 600000) });
    });
  });
  if (!batch.length) return;
  call_('post', '/api/bridge/handshake', { messages: batch });
  // FRIDAY also de-duplicates by message id; this list only avoids re-uploading the same mail.
  seen = batch.map(function (b) { return b.id; }).concat(seen).slice(0, 300);
  props.setProperty(SEEN_KEY, JSON.stringify(seen));
}

function sendApproved_() {
  var items = call_('get', '/api/bridge/outbox').items || [];
  items.forEach(function (it) {
    try {
      var opts = {};
      if (it.attachment) opts.attachments = [Utilities.newBlob(Utilities.base64Decode(it.attachment.base64), it.attachment.type, it.attachment.name)];
      var sent = GmailApp.createDraft(it.to, it.subject, it.body, opts).send();
      call_('post', '/api/bridge/sent', { id: it.id, messageId: sent.getId() });
    } catch (e) {
      call_('post', '/api/bridge/sent', { id: it.id, error: String(e && e.message ? e.message : e).slice(0, 900) });
    }
  });
}
