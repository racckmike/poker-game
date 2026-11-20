import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@poker/shared';

export const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'] });
