import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 3001);
const server = await startServer({ port });
console.log(`Servidor de póker escuchando en http://localhost:${server.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close().then(() => process.exit(0)));
