import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@poker/shared';

/** Game server address when the page is hosted elsewhere (e.g. page on Vercel, server on Render). Empty = same origin. */
export const SERVER_URL = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\/$/, '');

export const socket: Socket<ServerToClient, ClientToServer> = io(SERVER_URL || undefined, { transports: ['websocket', 'polling'] });
