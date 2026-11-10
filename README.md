# node-red-contrib-waservix

[![npm](https://img.shields.io/npm/v/node-red-contrib-waservix.svg)](https://www.npmjs.com/package/node-red-contrib-waservix)
[![tests](https://github.com/TekservixHQ/node-red-contrib-waservix/actions/workflows/tests.yml/badge.svg)](https://github.com/TekservixHQ/node-red-contrib-waservix/actions/workflows/tests.yml)

Node-RED nodes for [WAservix](https://tekservix.com/waservix/), the WhatsApp API gateway that sends from your own number.

WAservix links your WhatsApp number by QR code (the same way WhatsApp Web does). These nodes send text, images, documents, locations and polls from any flow, and react to incoming messages and status updates: alerts from Home Assistant or sensors, order notifications, chatbots and more.

## Install

In Node-RED: **Menu → Manage palette → Install**, search for `node-red-contrib-waservix`.

Or from your Node-RED user directory (usually `~/.node-red`):

```bash
npm install node-red-contrib-waservix
```

Needs Node-RED 3.0+ and Node.js 18+. No other dependencies.

## Setup

1. In the WAservix dashboard, add your number under **Devices** and scan the QR code with WhatsApp.
2. Copy the number's **API key**.
3. Add any WAservix node to a flow, open it, and create a **WAservix** config node with the key.

## Nodes

### waservix send

Sends a WhatsApp message to a number or a group (JID ending in `@g.us`).

- `msg.payload` as a string: sent as text (or set **Text** in the node)
- `msg.payload` as an object: sent as the full API body, e.g. `{ "poll": { "name": "Lunch?", "options": ["Pizza", "Sushi"] } }`
- `msg.to`: the recipient (or set **To**)
- media: `msg.imageUrl`, `msg.videoUrl`, `msg.audioUrl`, `msg.documentUrl` with `msg.caption` and `msg.fileName`
- `msg.location = { latitude, longitude, name }`, `msg.replyTo`, `msg.mentions`

Output: `msg.payload = { msgId, jid, status: "in_progress" }`. Messages are queued and sent one at a time per number.

### waservix api

Calls any endpoint of the [WAservix API](https://tekservix.com/waservix/docs/) and returns its `data`: for example `GET /status`, `GET /on-whatsapp/+15551234567`, `GET /messages/58213/info`, `PUT /messages/58213` (edit), `GET /groups`, `GET /contacts`.

### waservix webhook

Receives incoming messages, status updates, reactions, calls and session events, and rejects requests whose `X-Webhook-Signature` does not match your number's webhook secret.

```
[http in POST /waservix] → [waservix webhook] → your flow
                                  ↘ output 2 → [http response]
```

Set `https://<your-node-red>/waservix` as the webhook of your number in the WAservix dashboard, paste the secret into the node and optionally filter events (`messages.received`, `messages-personal.received`, `messages-group.received`, `messages.update`, `session.status`, ...). `msg.topic` is the event name.

Errors from the send and api nodes can be caught with a **catch** node: `msg.error` holds `status`, `message` and `errors`. A 503 means the number is reconnecting.

## Example

Import **Menu → Import → Examples → node-red-contrib-waservix → send-whatsapp**: an inject node that sends a test message, and a webhook flow that logs incoming messages.

## Use it responsibly

WAservix is not Meta's official WhatsApp Business Platform. There's no business verification and no per-conversation fee, but WhatsApp's spam rules apply to your number directly. Message people who expect to hear from you, warm up new numbers slowly and keep the built-in account protection on.

## More from Tekservix

- [SMS Gora SMS Gateway](https://tekservix.com/smsgora/): SMS through your own Android phones, also for Node-RED (`node-red-contrib-smsgora`)
- [AI Sales Agent](https://tekservix.com/ai-sales-agent): answers customers on WhatsApp and SMS using your website's content
- [Website to App](https://tekservix.com/mobile-apps): turn your website into Android and iOS apps
- WAservix libraries for 12 languages and n8n nodes: [github.com/TekservixHQ](https://github.com/TekservixHQ)

## License

MIT
