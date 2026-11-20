import { create } from 'zustand';
import type { ClientToServer, PlayerAction, RoomSettings, Session, TableView } from '@poker/shared';
import { announce, hangUp, onSignal, syncPeers } from './media';
import { socket } from './socket';

type ConnState = 'connecting' | 'online' | 'offline';

interface Store {
  conn: ConnState;
  view: TableView | null;
  error: string | null;
  busy: boolean;
  /** True while we try to rejoin a saved seat on page load. */
  resuming: boolean;
  createRoom(name: string): Promise<void>;
  joinRoom(name: string, code: string): Promise<void>;
  leave(): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  updateSettings(s: Partial<RoomSettings>): Promise<void>;
  startGame(): Promise<void>;
  act(action: PlayerAction): Promise<void>;
  show(): Promise<void>;
  restart(): Promise<void>;
  clearError(): void;
}

const SESSION_KEY = 'poker.session';
const NAME_KEY = 'poker.name';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: reconnection just won't survive a reload */
  }
}
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

function call<T>(event: keyof ClientToServer, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket.timeout(8000) as any).emit(event, ...args, (err: Error | null, res: Res<T>) => {
      if (err) return reject(new Error('El servidor no responde. Revisa tu conexión.'));
      if (!res.ok) return reject(new Error(res.error));
      resolve(res.data);
    });
  });
}

export const useStore = create<Store>((set, get) => {
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    set({ busy: true, error: null });
    try {
      return await fn();
    } catch (e) {
      set({ error: (e as Error).message });
      return undefined;
    } finally {
      set({ busy: false });
    }
  };

  const resume = async () => {
    const s = loadSession();
    if (!s) return set({ resuming: false });
    set({ resuming: true });
    try {
      await call<Session>('room:resume', { roomCode: s.roomCode, token: s.token });
      announce(); // the server resets cam/mic on every new connection
    } catch {
      saveSession(null);
      set({ view: null });
    } finally {
      set({ resuming: false });
    }
  };

  socket.on('connect', () => {
    set({ conn: 'online' });
    void resume();
  });
  socket.on('disconnect', () => set({ conn: 'offline' }));
  socket.io.on('reconnect_attempt', () => set({ conn: 'connecting' }));
  socket.on('state', (view) => {
    set({ view });
    syncPeers(view);
  });
  socket.on('rtc:signal', (m) => void onSignal(m));
  socket.on('kicked', (reason) => {
    hangUp();
    set({ view: null, error: reason });
  });

  return {
    conn: 'connecting',
    view: null,
    error: null,
    busy: false,
    resuming: !!loadSession(),

    createRoom: (name) =>
      run(async () => {
        saveName(name);
        saveSession(await call<Session>('room:create', { name }));
      }).then(() => {}),
    joinRoom: (name, roomCode) =>
      run(async () => {
        saveName(name);
        saveSession(await call<Session>('room:join', { name, roomCode }));
      }).then(() => {}),
    leave: () =>
      run(async () => {
        await call('room:leave');
        hangUp();
        saveSession(null);
        set({ view: null });
      }).then(() => {}),
    setReady: (ready) => run(() => call('lobby:ready', { ready })).then(() => {}),
    updateSettings: (s) => run(() => call('lobby:settings', s)).then(() => {}),
    startGame: () => run(() => call('game:start')).then(() => {}),
    act: (action) => {
      const v = get().view;
      if (!v || get().busy) return Promise.resolve();
      return run(() => call('game:action', { action, version: v.version })).then(() => {});
    },
    show: () => run(() => call('game:show')).then(() => {}),
    restart: () => run(() => call('game:restart')).then(() => {}),
    clearError: () => set({ error: null }),
  };
});

export const fmt = (n: number) => new Intl.NumberFormat('es-MX').format(n);
