import { create } from 'zustand';
import type { RtcSignal, TableView } from '@poker/shared';
import { SERVER_URL, socket } from './socket';

/**
 * Optional camera + microphone between players: a full mesh of WebRTC peer connections (≤ 7 per player).
 * The server only relays offers/answers/ICE inside the room; audio and video go device to device.
 * Every call carries one audio and one video transceiver from the start, so turning the camera or mic
 * on/off is a replaceTrack, never a renegotiation. The player with the smaller id always makes the offer.
 */

interface MediaState {
  cam: boolean;
  mic: boolean;
  /** My own preview (a new object whenever my tracks change). */
  local: MediaStream | null;
  remote: Record<string, MediaStream>;
  error: string | null;
}

export const useMedia = create<MediaState>(() => ({ cam: false, mic: false, local: null, remote: {}, error: null }));

interface Peer {
  pc: RTCPeerConnection;
  /** The peer's connection counter this call belongs to; signals for another one are stale. */
  rtc: number;
  pending: RTCIceCandidateInit[];
  stream: MediaStream;
}

const peers = new Map<string, Peer>();
const localTracks = new MediaStream();
let myId: string | null = null;
let myRtc = -1;
let lastView: TableView | null = null;
let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

fetch(`${SERVER_URL}/ice`)
  .then((r) => r.json())
  .then((s: RTCIceServer[]) => {
    if (Array.isArray(s) && s.length) iceServers = s;
  })
  .catch(() => {});

const trackOf = (kind: string) => localTracks.getTracks().find((t) => t.kind === kind) ?? null;
const send = (to: string, data: RtcSignal) => socket.emit('rtc:signal', { to, data });
const publish = () => useMedia.setState({ remote: Object.fromEntries([...peers].map(([id, p]) => [id, p.stream])) });

function closePeer(id: string) {
  const p = peers.get(id);
  if (!p) return;
  p.pc.close();
  peers.delete(id);
  publish();
}

function createPeer(id: string, rtc: number): Peer {
  const pc = new RTCPeerConnection({ iceServers });
  const peer: Peer = { pc, rtc, pending: [], stream: new MediaStream() };
  pc.onicecandidate = (e) => {
    if (e.candidate) send(id, { kind: 'ice', candidate: e.candidate.toJSON(), rtc: myRtc });
  };
  pc.ontrack = (e) => {
    peer.stream.addTrack(e.track);
    publish();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed' || peers.get(id) !== peer) return;
    closePeer(id);
    // The offering side tries again shortly with whatever the table looks like then.
    setTimeout(() => lastView && syncPeers(lastView), 2000);
  };
  peers.set(id, peer);
  publish();
  return peer;
}

async function flush(peer: Peer) {
  for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
}

async function attachLocal(pc: RTCPeerConnection) {
  for (const t of pc.getTransceivers()) {
    const kind = t.receiver.track.kind;
    await t.sender.replaceTrack(trackOf(kind)).catch(() => {});
  }
}

async function callPeer(id: string, rtc: number) {
  const { pc } = createPeer(id, rtc);
  pc.addTransceiver('audio', { direction: 'sendrecv' });
  pc.addTransceiver('video', { direction: 'sendrecv' });
  await attachLocal(pc);
  await pc.setLocalDescription(await pc.createOffer());
  if (pc.localDescription) send(id, { kind: 'offer', sdp: pc.localDescription.sdp, rtc: myRtc });
}

/** Called with every table state: opens, keeps or closes calls to match who is connected. */
export function syncPeers(view: TableView) {
  lastView = view;
  myId = view.youId;
  const me = view.players.find((p) => p.id === myId);
  if (!me) return;
  if (me.rtc !== myRtc) {
    // I reconnected: every old call is dead on the other side too.
    for (const id of [...peers.keys()]) closePeer(id);
    myRtc = me.rtc;
  }
  const live = new Map(view.players.filter((p) => p.id !== myId && p.connected).map((p) => [p.id, p]));
  for (const [id, peer] of peers) {
    const p = live.get(id);
    if (!p || p.rtc !== peer.rtc) closePeer(id);
  }
  for (const p of live.values()) {
    if (!peers.has(p.id) && myId < p.id) void callPeer(p.id, p.rtc).catch(() => closePeer(p.id));
  }
}

export async function onSignal({ from, data }: { from: string; data: RtcSignal }) {
  try {
    if (data.kind === 'offer') {
      closePeer(from);
      const peer = createPeer(from, data.rtc);
      const { pc } = peer;
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      for (const t of pc.getTransceivers()) t.direction = 'sendrecv';
      await attachLocal(pc);
      await pc.setLocalDescription(await pc.createAnswer());
      if (pc.localDescription) send(from, { kind: 'answer', sdp: pc.localDescription.sdp, rtc: myRtc });
      await flush(peer);
      return;
    }
    const peer = peers.get(from);
    if (!peer || peer.rtc !== data.rtc) return; // stale: belongs to an older connection
    if (data.kind !== 'ice') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await flush(peer);
    } else if (peer.pc.remoteDescription) {
      await peer.pc.addIceCandidate(data.candidate as RTCIceCandidateInit).catch(() => {});
    } else {
      peer.pending.push(data.candidate as RTCIceCandidateInit);
    }
  } catch {
    closePeer(from);
  }
}

function swapTrack(kind: 'audio' | 'video', next: MediaStreamTrack | null) {
  const old = trackOf(kind);
  if (old) {
    localTracks.removeTrack(old);
    old.stop(); // turns the camera light off
  }
  if (next) localTracks.addTrack(next);
  for (const { pc } of peers.values()) {
    for (const t of pc.getTransceivers()) {
      if (t.receiver.track.kind === kind && t.currentDirection !== 'stopped') void t.sender.replaceTrack(next).catch(() => {});
    }
  }
  useMedia.setState({ local: localTracks.getTracks().length ? new MediaStream(localTracks.getTracks()) : null });
}

/** Tells the table what I'm sharing (also re-sent after every reconnect). */
export function announce() {
  const { cam, mic } = useMedia.getState();
  if (myId) socket.emit('media:state', { cam, mic }, () => {});
}

const ERRORS: Record<string, string> = {
  NotAllowedError: 'Bloqueaste el permiso. Actívalo en los ajustes del navegador para este sitio.',
  NotFoundError: 'No encontramos ese dispositivo en este aparato.',
  NotReadableError: 'Otra aplicación está usando ese dispositivo.',
};

async function toggle(kind: 'audio' | 'video', on: boolean) {
  const key = kind === 'video' ? 'cam' : 'mic';
  if (on) {
    if (!navigator.mediaDevices?.getUserMedia) {
      useMedia.setState({ error: 'La cámara y el micrófono solo funcionan con una conexión segura (https).' });
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia(
        kind === 'video'
          ? { video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } } }
          : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
      );
      swapTrack(kind, s.getTracks()[0]);
    } catch (e) {
      useMedia.setState({ error: ERRORS[(e as Error).name] ?? 'No pudimos encender el dispositivo.' });
      return;
    }
  } else swapTrack(kind, null);
  useMedia.setState({ [key]: on, error: null } as Partial<MediaState>);
  announce();
}

export const setCam = (on: boolean) => toggle('video', on);
export const setMic = (on: boolean) => toggle('audio', on);

/** Leaving the room: hang up and release the camera and microphone. */
export function hangUp() {
  for (const id of [...peers.keys()]) closePeer(id);
  swapTrack('video', null);
  swapTrack('audio', null);
  myId = null;
  myRtc = -1;
  lastView = null;
  useMedia.setState({ cam: false, mic: false });
}
