// The wire, and the one constant in it that cannot be checked by inspection.
//
// The WebSocket handshake fails in the worst possible way when it is wrong: the
// server sends a syntactically perfect 101 with a plausible base64 accept
// value, and every client refuses it without saying why. There is nothing to
// see in a log. So the RFC's own test vector is asserted here.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseClientMessage, encode, PROTOCOL_VERSION } from '../server/protocol.ts';
import { check, assert, suite } from './harness.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

suite('websocket handshake', () => {
  // Section 1.3 of RFC 6455 gives this exact pair.
  const RFC_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
  const RFC_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

  const source = readFileSync(join(ROOT, 'server', 'ws.ts'), 'utf8');
  const found = /const GUID = '([^']+)'/.exec(source);
  assert('ws.ts declares a GUID', found !== null);
  const guid = found?.[1] ?? '';

  const accept = createHash('sha1').update(RFC_KEY + guid).digest('base64');
  assert('the handshake reproduces the RFC 6455 test vector', accept === RFC_ACCEPT);
  check('GUID length', guid.length, 36, 0);
});

suite('message parsing', () => {
  // Everything from a client is untrusted, and a bad frame must not throw --
  // one malformed message must not be able to stop a shared turn loop.
  const bad = ['', 'not json', '{}', '[]', 'null', '{"t":"nope"}', '{"t":"hello"}',
    '{"t":"order","target":5}', '{"t":"hash","region":"x"}'];
  let threw = 0;
  let accepted = 0;
  for (const raw of bad) {
    try {
      if (parseClientMessage(raw) !== null) accepted++;
    } catch { threw++; }
  }
  check('malformed messages never throw', threw, 0, 0);
  check('malformed messages are all rejected', accepted, 0, 0);

  const hello = parseClientMessage('{"t":"hello","version":1,"name":"alice"}');
  assert('a good hello parses', hello?.t === 'hello');

  // A name is shown to other players, so it must be bounded here rather than
  // trusted. Same for an address key.
  const long = parseClientMessage(`{"t":"hello","version":1,"name":"${'x'.repeat(500)}"}`);
  check('names are truncated', long?.t === 'hello' ? long.name.length : -1, 32, 0);

  const order = parseClientMessage('{"t":"order","action":"settle","target":"1.2.3","amount":5.7}');
  assert('a good order parses', order?.t === 'order');
  check('a fractional amount is floored', order?.t === 'order' ? order.amount ?? -1 : -1, 5, 0);

  const negative = parseClientMessage('{"t":"order","action":"settle","target":"1.2.3","amount":-9}');
  check('a negative amount is clamped', negative?.t === 'order' ? negative.amount ?? -1 : -1, 0, 0);

  assert('an unknown action is rejected',
    parseClientMessage('{"t":"order","action":"nuke","target":"1.2.3"}') === null);

  check('protocol version', PROTOCOL_VERSION, 1, 0);
  assert('encode produces json', encode({ t: 'error', reason: 'x' }).startsWith('{'));
});
