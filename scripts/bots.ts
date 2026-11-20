// Dev helper: fills a room with simple bots so you can test alone.
// Usage: npx tsx scripts/bots.ts POKER-XXXXXX [count=3] [url=http://localhost:3001]
import { io } from 'socket.io-client';
import type { TableView } from '@poker/shared';

const [code, countArg, urlArg] = process.argv.slice(2);
if (!code) {
  console.error('Uso: npx tsx scripts/bots.ts POKER-XXXXXX [cantidad] [url]');
  process.exit(1);
}
const names = ['Lucía', 'Carlos', 'Rosa', 'Andrés', 'Marta', 'Jorge', 'Elena'];
const url = urlArg ?? 'http://localhost:3001';

for (let i = 0; i < Number(countArg ?? 3); i++) {
  const s = io(url, { transports: ['websocket'] });
  let acting = false;
  s.on('connect', async () => {
    const res = await s.emitWithAck('room:join', { name: names[i], roomCode: code });
    if (!res.ok) return console.error(names[i], res.error);
    await s.emitWithAck('lobby:ready', { ready: true });
    console.log(`${names[i]} se sentó`);
  });
  let latest: TableView | null = null;
  const think = () => {
    const v = latest;
    const l = v?.legal;
    if (!v || !l || acting) return;
    acting = true;
    setTimeout(async () => {
      const r = Math.random();
      const action =
        l.raise && r < 0.12 ? { type: 'raise', amount: l.raise.min } :
        l.bet && r < 0.25 ? { type: 'bet', amount: l.bet.min } :
        l.fold && r > 0.85 ? { type: 'fold' } :
        l.check ? { type: 'check' } : { type: 'call' };
      await s.emitWithAck('game:action', { action, version: latest!.version });
      acting = false;
      think(); // a new turn may have arrived while we were acting
    }, 700 + Math.random() * 900);
  };
  s.on('state', (v: TableView) => {
    latest = v;
    think();
  });
}
