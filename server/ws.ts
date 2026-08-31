// A WebSocket server, in about two hundred lines and no dependencies.
//
// `ws` is one npm install and would do this better. It is not here because the
// whole project currently runs on a bare Node with nothing installed -- the
// suites, the generator and the server all execute TypeScript directly -- and
// keeping that true is worth more than the hundred lines. If this ever needs
// permessage-deflate, fragmentation across many frames, or to face the open
// internet, swap it for `ws` and delete this file without regret.
//
// RFC 6455, the parts that matter:
//
//   The handshake is a plain HTTP upgrade. The client sends a random 16-byte
//   key, base64'd; the server appends a fixed GUID, SHA-1s the result and
//   sends it back. This proves nothing about security -- it exists so that a
//   caching proxy which does not understand WebSocket cannot accidentally
//   complete the handshake from cache.
//
//   Every frame from a client is masked with a four-byte key, and the server
//   MUST reject an unmasked one. The masking is not encryption either; it
//   stops a malicious page from making a WebSocket payload look like a valid
//   HTTP request to a confused proxy.
//
//   Frames from the server are never masked.

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

// RFC 6455's magic string. Transcribe it wrong by one character and the
// handshake still looks perfect -- the server sends a well-formed 101 with a
// plausible base64 accept value, and every client silently refuses it. It was
// written here as ...95CA-5AB0DC85B11F, moving the C off the front of the last
// group and onto the end as an F, and cost an hour. verify_protocol.ts now
// pins it against the test vector in the RFC.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const Opcode = {
  Continuation: 0x0,
  Text: 0x1,
  Binary: 0x2,
  Close: 0x8,
  Ping: 0x9,
  Pong: 0xa,
} as const;

export interface WsHandlers {
  onMessage?: (text: string) => void;
  onClose?: () => void;
}

export class WsConnection {
  // Typed as the general Buffer rather than the ArrayBuffer-backed one that
  // `Buffer.alloc` infers: a chunk off a socket may be backed by anything, and
  // the narrower inferred type made concat with a real chunk a type error.
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private closed = false;
  private handlers: WsHandlers = {};
  /** Parts of a fragmented message, joined when the FIN frame arrives. */
  private fragments: Buffer[] = [];

  // Fields written out rather than declared as constructor parameters. Node's
  // type stripping is erase-only -- it never emits code -- so a parameter
  // property, which exists purely as generated assignments, cannot survive it.
  private readonly socket: Duplex;
  readonly id: number;

  constructor(socket: Duplex, id: number) {
    this.socket = socket;
    this.id = id;
    socket.on('data', (chunk: Buffer) => this.feed(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  on(handlers: WsHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  send(text: string): void {
    if (this.closed) return;
    this.socket.write(frame(Opcode.Text, Buffer.from(text, 'utf8')));
  }

  close(): void {
    if (this.closed) return;
    this.socket.write(frame(Opcode.Close, Buffer.alloc(0)));
    this.socket.end();
    this.finish();
  }

  get isOpen(): boolean { return !this.closed; }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose?.();
  }

  /**
   * Feed bytes in, take messages out.
   *
   * TCP gives no message boundaries whatsoever: one `data` event may carry half
   * a frame, three frames, or two and a half. So everything accumulates in a
   * buffer and is only consumed once a whole frame is present. Getting this
   * wrong produces a server that works perfectly on localhost and falls apart
   * over a real network, which is the worst possible failure schedule.
   */
  private feed(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      const parsed = parseFrame(this.buffer);
      if (parsed === null) return; // need more bytes
      this.buffer = this.buffer.subarray(parsed.consumed);

      switch (parsed.opcode) {
        case Opcode.Text:
        case Opcode.Binary:
        case Opcode.Continuation: {
          this.fragments.push(parsed.payload);
          if (parsed.fin) {
            const whole = this.fragments.length === 1
              ? this.fragments[0]
              : Buffer.concat(this.fragments);
            this.fragments = [];
            this.handlers.onMessage?.(whole.toString('utf8'));
          }
          break;
        }
        case Opcode.Ping:
          this.socket.write(frame(Opcode.Pong, parsed.payload));
          break;
        case Opcode.Pong:
          break;
        case Opcode.Close:
          this.close();
          return;
        default:
          // An opcode we do not know is a protocol error, and the spec says to
          // fail the connection rather than carry on hopefully.
          this.close();
          return;
      }
    }
  }
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  consumed: number;
}

function parseFrame(buf: Buffer): ParsedFrame | null {
  if (buf.length < 2) return null;

  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buf.length < offset + 2) return null;
    length = buf.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buf.length < offset + 8) return null;
    const big = buf.readBigUInt64BE(offset);
    // A frame larger than a safe integer cannot be indexed, and nothing this
    // protocol sends is anywhere near it. Refuse rather than truncate.
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('websocket frame too large');
    length = Number(big);
    offset += 8;
  }

  let mask: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + length) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + length));
  if (mask !== null) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }

  return { fin, opcode, payload, consumed: offset + length };
}

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN set: we never fragment outgoing messages
  return Buffer.concat([header, payload]);
}

/**
 * Complete the HTTP upgrade and hand back a live connection.
 *
 * Returns null and destroys the socket if the request is not a valid WebSocket
 * upgrade, which is the correct response to anything from a port scanner.
 */
export function accept(req: IncomingMessage, socket: Duplex, id: number): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (typeof key !== 'string' || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }

  const accepted = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accepted}\r\n\r\n`,
  );
  // Nagle batches small writes, and every message this protocol sends is small
  // and latency-sensitive. Turning it off costs a few packets and saves 40 ms
  // on every order acknowledgement.
  if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') {
    socket.setNoDelay(true);
  }
  return new WsConnection(socket, id);
}
