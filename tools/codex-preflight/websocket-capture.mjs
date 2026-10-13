import { createHash } from 'node:crypto';

/** Minimal local WebSocket sink. Headers/auth are neither inspected nor retained. */
export function installWebSocketCapture(server, inspect, onCapture, onBootstrap = () => {}) {
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    if (!key || !request.url.includes('responses')) { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let buffer = Buffer.alloc(0);
    let fragments = [];
    let fragmentBytes = 0;
    let bootstrap;
    const send = packet => {
      const payload = Buffer.from(JSON.stringify(packet));
      const header = Buffer.alloc(4); header[0] = 129; header[1] = 126; header.writeUInt16BE(payload.length, 2);
      socket.write(Buffer.concat([header, payload]));
    };
    socket.on('error', () => {});
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 8 * 1024 * 1024 + 14) { socket.destroy(); return; }
      while (buffer.length >= 2) {
        const fin = (buffer[0] & 128) !== 0;
        const opcode = buffer[0] & 15;
        const masked = (buffer[1] & 128) !== 0;
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          const size = buffer.readBigUInt64BE(2);
          if (size > 8n * 1024n * 1024n) { socket.destroy(); return; }
          length = Number(size); offset = 10;
        }
        const maskOffset = offset;
        if (masked) offset += 4;
        if (buffer.length < offset + length) return;
        const payload = Buffer.from(buffer.subarray(offset, offset + length));
        if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[maskOffset + i % 4];
        buffer = buffer.subarray(offset + length);
        if (opcode === 8) { socket.end(); return; }
        if (opcode === 9) {
          if (payload.length < 126) socket.write(Buffer.concat([Buffer.from([138, payload.length]), payload]));
          continue;
        }
        if (opcode === 10) continue;
        if (![0, 1].includes(opcode) || !masked) { socket.destroy(); return; }
        fragmentBytes += payload.length;
        if (fragmentBytes > 8 * 1024 * 1024) { socket.destroy(); return; }
        fragments.push(payload);
        if (!fin) continue;
        try {
          const packet = JSON.parse(Buffer.concat(fragments));
          const body = packet.response || packet;
          if (body.input?.length === 0 && body.generate === false && !bootstrap) {
            bootstrap = body;
            onBootstrap(inspect(body));
            // Diagnostic local handshake only; never represent this as an AI response.
            const response = { id: 'frameronin_local_bootstrap', object: 'response',
              created_at: 0, status: 'completed', output: [], model: body.model,
              usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
            send({ type: 'response.created', response: { ...response, status: 'in_progress' } });
            send({ type: 'response.completed', response });
            fragments = []; fragmentBytes = 0; continue;
          }
          if (body.input) onCapture(inspect({ ...bootstrap, ...body }));
          const error = Buffer.from(JSON.stringify({ type: 'error', status: 400,
            error: { type: 'invalid_request_error', message: 'FRAMERONIN_LOCAL_CAPTURE_COMPLETE' } }));
          const header = Buffer.alloc(4); header[0] = 129; header[1] = 126; header.writeUInt16BE(error.length, 2);
          socket.end(Buffer.concat([header, error]));
        } catch { socket.destroy(); }
        fragments = [];
        fragmentBytes = 0;
      }
    });
  });
}
