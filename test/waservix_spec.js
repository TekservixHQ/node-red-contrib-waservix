const assert = require('assert');
const helper = require('node-red-node-test-helper');
const waservix = require('../nodes/waservix.js');

helper.init(require.resolve('node-red'));

describe('waservix nodes', function () {
  let calls;
  const realFetch = global.fetch;

  beforeEach(function (done) {
    calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/down')) {
        return new Response('{"success":false,"message":"Device reconnecting"}', { status: 503 });
      }
      return new Response('{"success":true,"data":{"msgId":58213,"status":"in_progress"}}', { status: 200 });
    };
    helper.startServer(done);
  });

  afterEach(function (done) {
    global.fetch = realFetch;
    helper.unload().then(() => helper.stopServer(done));
  });

  const flow = (extra) => [
    { id: 'cfg', type: 'waservix-config', baseUrl: 'https://example.test/api/' },
    Object.assign({ id: 'n1', type: 'waservix-send', config: 'cfg', wires: [['out']] }, extra),
    { id: 'out', type: 'helper' },
  ];

  function expectCall(done, check) {
    helper.getNode('out').on('input', (msg) => {
      try {
        check(msg);
        done();
      } catch (e) {
        done(e);
      }
    });
  }

  it('sends text from msg.payload', function (done) {
    helper.load(waservix, flow({}), { cfg: { apiKey: 'wpk_test' } }, function () {
      expectCall(done, (msg) => {
        assert.strictEqual(msg.payload.msgId, 58213);
        assert.strictEqual(calls[0].url, 'https://example.test/api/send-message');
        assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer wpk_test');
        assert.deepStrictEqual(calls[0].body, { to: '+1555', text: 'hi' });
      });
      helper.getNode('n1').receive({ payload: 'hi', to: '+1555' });
    });
  });

  it('sends media with caption and node defaults', function (done) {
    helper.load(waservix, flow({ to: '+1777' }), { cfg: { apiKey: 'k' } }, function () {
      expectCall(done, () => {
        assert.deepStrictEqual(calls[0].body, {
          to: '+1777',
          documentUrl: 'https://x/a.pdf',
          fileName: 'a.pdf',
          text: 'Your invoice',
        });
      });
      helper.getNode('n1').receive({ documentUrl: 'https://x/a.pdf', fileName: 'a.pdf', caption: 'Your invoice' });
    });
  });

  it('sends an object payload as the full body', function (done) {
    helper.load(waservix, flow({ to: '1203@g.us' }), { cfg: { apiKey: 'k' } }, function () {
      expectCall(done, () => {
        assert.deepStrictEqual(calls[0].body, { to: '1203@g.us', poll: { name: 'Lunch?', options: ['Yes', 'No'] } });
      });
      helper.getNode('n1').receive({ payload: { poll: { name: 'Lunch?', options: ['Yes', 'No'] } } });
    });
  });

  it('api node calls any path', function (done) {
    const f = [
      { id: 'cfg', type: 'waservix-config', baseUrl: 'https://example.test/api' },
      { id: 'a1', type: 'waservix-api', config: 'cfg', method: 'GET', path: '/groups', wires: [['out']] },
      { id: 'out', type: 'helper' },
    ];
    helper.load(waservix, f, { cfg: { apiKey: 'k' } }, function () {
      expectCall(done, () => {
        assert.strictEqual(calls[0].url, 'https://example.test/api/groups');
        assert.strictEqual(calls[0].init.method, 'GET');
      });
      helper.getNode('a1').receive({});
    });
  });

  it('request helper turns API errors into exceptions', async function () {
    await assert.rejects(
      waservix.waservixRequest({ baseUrl: 'https://example.test/down', credentials: { apiKey: 'k' } }, 'GET', '/status'),
      (err) => err.status === 503 && err.message === 'Device reconnecting',
    );
  });

  it('webhook node checks the secret and filters events', function (done) {
    const f = [
      { id: 'w1', type: 'waservix-webhook', events: 'messages.received', wires: [['ok'], ['rej']] },
      { id: 'ok', type: 'helper' },
      { id: 'rej', type: 'helper' },
    ];
    helper.load(waservix, f, { w1: { secret: 'abc' } }, function () {
      const rejected = [];
      helper.getNode('rej').on('input', (msg) => rejected.push(msg.statusCode));
      helper.getNode('ok').on('input', (msg) => {
        try {
          assert.deepStrictEqual(rejected, [401, 200]);
          assert.strictEqual(msg.topic, 'messages.received');
          done();
        } catch (e) {
          done(e);
        }
      });
      const w = helper.getNode('w1');
      w.receive({ payload: { event: 'messages.received' }, req: { headers: { 'x-webhook-signature': 'bad' } } });
      w.receive({ payload: { event: 'session.status' }, req: { headers: { 'x-webhook-signature': 'abc' } } });
      w.receive({ payload: { event: 'messages.received' }, req: { headers: { 'x-webhook-signature': 'abc' } } });
    });
  });

  it('verifyWebhook is exact', function () {
    assert.ok(waservix.verifyWebhook('abc', 'abc'));
    assert.ok(!waservix.verifyWebhook('abd', 'abc'));
    assert.ok(!waservix.verifyWebhook('abcd', 'abc'));
    assert.ok(!waservix.verifyWebhook(undefined, 'abc'));
  });
});
