// Server-sent events to every open window.
const clients = new Set();
export function addClient(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'hello', serverTime: Date.now() })}\n\n`);
  clients.add(res);
  res.on('close', () => clients.delete(res));
}
export function emit(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(line);
}
setInterval(() => emit({ type: 'ping' }), 25_000).unref();
