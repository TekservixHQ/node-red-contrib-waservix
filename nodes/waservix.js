'use strict';

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://tekservix.com/waservix/api';
const VERSION = require('../package.json').version;

// One call to the WAservix API. Resolves with the `data` part of the answer.
async function waservixRequest(config, method, path, body) {
  const apiKey = config.credentials && config.credentials.apiKey;
  if (!apiKey) throw new Error('WAservix: add your API key to the WAservix config node');
  const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const res = await fetch(base + path, {
    method,
    headers: Object.assign(
      {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
        'User-Agent': 'node-red-contrib-waservix/' + VERSION,
      },
      body === undefined ? {} : { 'Content-Type': 'application/json' },
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch (e) {
    json = undefined;
  }
  if (!res.ok || (json && json.success === false)) {
    const err = new Error((json && typeof json.message === 'string' && json.message) || 'HTTP ' + res.status);
    err.status = res.status;
    err.errors = json && json.errors;
    err.body = json === undefined ? text : json;
    const retry = res.headers.get('retry-after');
    if (retry) err.retryAfter = Number(retry);
    throw err;
  }
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

/** Constant-time check of the X-Webhook-Signature header against the number's webhook secret. */
function verifyWebhook(signature, secret) {
  if (!signature || !secret) return false;
  const a = Buffer.from(String(signature));
  const b = Buffer.from(String(secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function toList(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (value === undefined || value === null) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = function (RED) {
  function WAservixConfigNode(n) {
    RED.nodes.createNode(this, n);
    this.name = n.name;
    this.baseUrl = n.baseUrl || DEFAULT_BASE_URL;
  }
  RED.nodes.registerType('waservix-config', WAservixConfigNode, {
    credentials: { apiKey: { type: 'password' } },
  });

  function fail(node, msg, done, err) {
    node.status({ fill: 'red', shape: 'dot', text: err.status ? 'HTTP ' + err.status : 'error' });
    msg.error = { message: err.message, status: err.status, errors: err.errors, retryAfter: err.retryAfter };
    done(err);
  }

  // Send a WhatsApp message. Text from msg.payload; media and other fields from msg.* or the node.
  function WAservixSendNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    node.config = RED.nodes.getNode(n.config);
    node.to = n.to;
    node.text = n.text;

    node.on('input', async (msg, send, done) => {
      if (!node.config) return done(new Error('WAservix: choose a WAservix config node'));
      const to = msg.to !== undefined ? String(msg.to) : node.to;
      if (!to) return done(new Error('WAservix: no recipient (set "To" or msg.to)'));

      const body = { to };
      if (msg.payload && typeof msg.payload === 'object' && !Buffer.isBuffer(msg.payload)) {
        Object.assign(body, msg.payload); // full API body, e.g. { imageUrl, text } or { poll: {...} }
        body.to = to;
      } else if (msg.payload !== undefined && String(msg.payload) !== '') {
        body.text = String(msg.payload);
      } else if (node.text) {
        body.text = node.text;
      }
      for (const field of ['imageUrl', 'videoUrl', 'audioUrl', 'documentUrl', 'fileName', 'location', 'poll', 'replyTo']) {
        if (msg[field] !== undefined) body[field] = msg[field];
      }
      if (msg.caption !== undefined) body.text = msg.caption;
      if (msg.mentions !== undefined) body.mentions = toList(msg.mentions);
      if (Object.keys(body).length === 1) return done(new Error('WAservix: nothing to send (set msg.payload or a media URL)'));

      node.status({ fill: 'blue', shape: 'dot', text: 'sending' });
      try {
        msg.payload = await waservixRequest(node.config, 'POST', '/send-message', body);
        node.status({ fill: 'green', shape: 'dot', text: 'queued ' + (msg.payload && msg.payload.msgId) });
        send(msg);
        done();
      } catch (err) {
        fail(node, msg, done, err);
      }
    });
  }
  RED.nodes.registerType('waservix-send', WAservixSendNode);

  // Call any WAservix endpoint: msg.method, msg.path, msg.payload (body).
  function WAservixApiNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    node.config = RED.nodes.getNode(n.config);
    node.method = n.method || 'GET';
    node.path = n.path || '/status';

    node.on('input', async (msg, send, done) => {
      if (!node.config) return done(new Error('WAservix: choose a WAservix config node'));
      const method = String(msg.method || node.method).toUpperCase();
      const path = msg.path || node.path;
      const body = method === 'GET' || method === 'DELETE' || typeof msg.payload !== 'object' ? undefined : msg.payload;
      node.status({ fill: 'blue', shape: 'dot', text: method + ' ' + path });
      try {
        msg.payload = await waservixRequest(node.config, method, path, body);
        node.status({});
        send(msg);
        done();
      } catch (err) {
        fail(node, msg, done, err);
      }
    });
  }
  RED.nodes.registerType('waservix-api', WAservixApiNode);

  // Check an incoming webhook (from an http in node) and pass it on only if the secret matches.
  function WAservixWebhookNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    node.events = n.events || '';

    node.on('input', (msg, send, done) => {
      const secret = node.credentials && node.credentials.secret;
      const headers = (msg.req && msg.req.headers) || {};
      if (secret && !verifyWebhook(headers['x-webhook-signature'], secret)) {
        node.status({ fill: 'red', shape: 'ring', text: 'bad signature' });
        msg.statusCode = 401;
        send([null, msg]);
        return done();
      }
      let event = msg.payload;
      if (typeof event === 'string' || Buffer.isBuffer(event)) {
        try {
          event = JSON.parse(event.toString());
        } catch (e) {
          return done(new Error('WAservix: webhook body is not JSON'));
        }
      }
      const wanted = toList(node.events);
      if (wanted.length && !wanted.includes(event && event.event)) {
        msg.statusCode = 200;
        send([null, msg]);
        return done();
      }
      msg.payload = event;
      msg.topic = event && event.event;
      msg.statusCode = 200;
      node.status({ fill: 'green', shape: 'dot', text: msg.topic || 'event' });
      send([msg, null]);
      done();
    });
  }
  RED.nodes.registerType('waservix-webhook', WAservixWebhookNode, {
    credentials: { secret: { type: 'password' } },
  });
};

module.exports.waservixRequest = waservixRequest;
module.exports.verifyWebhook = verifyWebhook;
