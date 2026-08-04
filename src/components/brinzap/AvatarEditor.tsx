// Editor de foto de perfil: escolher da galeria, tirar foto, cortar (zoom + arrastar),
// pré-visualizar e salvar. Resultado é um data URI JPEG 320x320.
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, Trash2, X, Check, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentUrl?: string | null;
  onSave: (dataUri: string | null) => Promise<void> | void;
};

const OUT = 320;
const BOX = 260;

export function AvatarEditor({ open, onOpenChange, currentUrl, onSave }: Props) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setSrc(null); setImg(null); setZoom(1); setPos({ x: 0, y: 0 }); setPreview(null); setBusy(false);
    }
  }, [open]);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const image = new Image();
      image.onload = () => { setImg(image); setZoom(1); setPos({ x: 0, y: 0 }); setPreview(null); };
      image.src = url;
      setSrc(url);
    };
    reader.readAsDataURL(f);
  };

  const render = useCallback((): string | null => {
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUT, OUT);
    const base = Math.max(BOX / img.width, BOX / img.height);
    const scale = (base * zoom * OUT) / BOX;
    const w = img.width * scale;
    const h = img.height * scale;
    const k = OUT / BOX;
    ctx.drawImage(img, OUT / 2 - w / 2 + pos.x * k, OUT / 2 - h / 2 + pos.y * k, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, [img, zoom, pos]);

  if (!open) return null;

  const base = img ? Math.max(BOX / img.width, BOX / img.height) : 1;
  const dispW = img ? img.width * base * zoom : 0;
  const dispH = img ? img.height * base * zoom : 0;

  const onDown = (cx: number, cy: number) => { drag.current = { x: cx, y: cy, ox: pos.x, oy: pos.y }; };
  const onMove = (cx: number, cy: number) => {
    if (!drag.current) return;
    setPos({ x: drag.current.ox + (cx - drag.current.x), y: drag.current.oy + (cy - drag.current.y) });
  };
  const onUp = () => { drag.current = null; };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Foto de perfil</h2>
          <button onClick={() => onOpenChange(false)} aria-label="Fechar" className="h-8 w-8 grid place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => pick(e.target.files?.[0])} />

        {!src && (
          <div className="flex flex-col items-center gap-4">
            <div className="h-28 w-28 rounded-full overflow-hidden border border-border bg-muted grid place-items-center">
              {currentUrl ? <img src={currentUrl} alt="Foto atual" className="h-full w-full object-cover" />
                : <Camera className="h-8 w-8 text-muted-foreground" />}
            </div>
            <div className="grid grid-cols-1 gap-2 w-full">
              <button onClick={() => cameraRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-border px-3 h-11 text-sm hover:bg-muted">
                <Camera className="h-4 w-4 text-primary" /> Tirar foto
              </button>
              <button onClick={() => galleryRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-border px-3 h-11 text-sm hover:bg-muted">
                <ImageIcon className="h-4 w-4 text-primary" /> Escolher da galeria
              </button>
              {currentUrl && (
                <button
                  onClick={async () => { setBusy(true); await onSave(null); setBusy(false); onOpenChange(false); }}
                  className="flex items-center gap-2 rounded-xl border border-destructive/40 text-destructive px-3 h-11 text-sm hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Remover foto
                </button>
              )}
            </div>
          </div>
        )}

        {src && !preview && (
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative overflow-hidden rounded-full border border-primary/40 touch-none select-none cursor-grab active:cursor-grabbing"
              style={{ width: BOX, height: BOX }}
              onMouseDown={(e) => onDown(e.clientX, e.clientY)}
              onMouseMove={(e) => onMove(e.clientX, e.clientY)}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={(e) => onDown(e.touches[0].clientX, e.touches[0].clientY)}
              onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY)}
              onTouchEnd={onUp}
            >
              {img && (
                <img
                  src={src} alt="Recortar"
                  draggable={false}
                  className="absolute max-w-none pointer-events-none"
                  style={{ width: dispW, height: dispH, left: BOX / 2 - dispW / 2 + pos.x, top: BOX / 2 - dispH / 2 + pos.y }}
                />
              )}
            </div>
            <label className="w-full text-xs text-muted-foreground">
              Zoom
              <input type="range" min={1} max={3} step={0.01} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
            </label>
            <div className="grid grid-cols-2 gap-2 w-full">
              <button onClick={() => { setSrc(null); setImg(null); }} className="rounded-xl border border-border h-11 text-sm hover:bg-muted">Trocar</button>
              <button onClick={() => setPreview(render())} className="rounded-xl bg-primary text-primary-foreground h-11 text-sm font-medium">Pré-visualizar</button>
            </div>
          </div>
        )}

        {preview && (
          <div className="flex flex-col items-center gap-4">
            <img src={preview} alt="Pré-visualização" className="h-32 w-32 rounded-full object-cover border border-border" />
            <p className="text-xs text-muted-foreground">É assim que sua foto vai aparecer.</p>
            <div className="grid grid-cols-2 gap-2 w-full">
              <button onClick={() => setPreview(null)} className="rounded-xl border border-border h-11 text-sm hover:bg-muted">Ajustar</button>
              <button
                disabled={busy}
                onClick={async () => { setBusy(true); await onSave(preview); setBusy(false); onOpenChange(false); }}
                className="rounded-xl bg-primary text-primary-foreground h-11 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
