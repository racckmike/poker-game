import { useEffect, useRef } from 'react';
import type { SeatView } from '@poker/shared';
import { setCam, setMic, useMedia } from '../media';

/** Drawn icons, one stroke weight. */
function Icon({ name, className = 'size-5' }: { name: 'cam' | 'cam-off' | 'mic' | 'mic-off'; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...common}>
      {name.startsWith('cam') ? (
        <>
          <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
          <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
        </>
      ) : (
        <>
          <rect x="9" y="2.5" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
        </>
      )}
      {name.endsWith('off') && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Camera + microphone switches. Off by default; each player decides. */
export function MediaControls({ className = '' }: { className?: string }) {
  const { cam, mic, error } = useMedia();
  const btn = (on: boolean) =>
    `grid size-11 place-items-center rounded-full border transition active:scale-95 ${
      on ? 'border-cream bg-cream text-room' : 'border-cream/25 bg-room-2/90 text-cream hover:border-cream/60'
    }`;
  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <div className="flex gap-2">
        <button type="button" onClick={() => void setCam(!cam)} aria-pressed={cam} aria-label={cam ? 'Apagar cámara' : 'Encender cámara'} title={cam ? 'Apagar cámara' : 'Encender cámara'} className={btn(cam)}>
          <Icon name={cam ? 'cam' : 'cam-off'} />
        </button>
        <button type="button" onClick={() => void setMic(!mic)} aria-pressed={mic} aria-label={mic ? 'Apagar micrófono' : 'Encender micrófono'} title={mic ? 'Apagar micrófono' : 'Encender micrófono'} className={btn(mic)}>
          <Icon name={mic ? 'mic' : 'mic-off'} />
        </button>
      </div>
      {error && (
        <p role="alert" className="max-w-[16rem] rounded-md bg-room-2 px-2.5 py-1.5 text-[13px] text-cream shadow-(--shadow-object)">
          {error}{' '}
          <button className="font-bold text-ember underline underline-offset-2" onClick={() => useMedia.setState({ error: null })}>
            Cerrar
          </button>
        </p>
      )}
    </div>
  );
}

function Video({ stream, mirror }: { stream: MediaStream; mirror: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`size-full object-cover ${mirror ? '-scale-x-100' : ''}`} />;
}

/** A player's face: their camera if they share it, otherwise their initials. Shows a mic mark while they can be heard. */
export function Avatar({ p, isMe = false, size = 44 }: { p: Pick<SeatView, 'id' | 'name' | 'cam' | 'mic'>; isMe?: boolean; size?: number }) {
  const local = useMedia((s) => s.local);
  const remote = useMedia((s) => s.remote[p.id]);
  const stream = isMe ? local : remote;
  const showVideo = p.cam && !!stream?.getVideoTracks().length;
  const initials = p.name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="grid size-full place-items-center overflow-hidden rounded-full bg-room-3 font-bold leading-none text-cream ring-2 ring-cream/80" style={{ fontSize: size * 0.38 }}>
        {showVideo ? <Video stream={stream!} mirror={isMe} /> : <span aria-hidden>{initials}</span>}
      </div>
      {p.mic && (
        <span className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-cream text-room shadow-(--shadow-object)" title="Micrófono encendido">
          <Icon name="mic" className="size-3" />
        </span>
      )}
    </div>
  );
}

/** Plays everyone else's microphone. Video elements stay muted; sound comes only from here. */
export function RemoteAudio() {
  const remote = useMedia((s) => s.remote);
  return (
    <>
      {Object.entries(remote).map(([id, stream]) => (
        <Audio key={id} stream={stream} />
      ))}
    </>
  );
}

function Audio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}
