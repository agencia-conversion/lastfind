'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useCopy, useNumbers } from './shared';
import type { DemoUser } from './workspace-data';
import { AccountAvatar } from './account-avatar';

type Avatar = NonNullable<DemoUser['avatar']>;

// The signed-in person's photo, one for the whole page: a save or a removal in Settings > My profile redraws every
// UserAvatar at once (the sidebar's account row, its menu, the members card). `version` changes the photo's address so
// the browser asks again; `preview` is the demo's photo, kept in the page only (the demo saves nothing).
let accountPhoto: { version: number; preview?: string | null } = { version: 0 };
const listeners = new Set<() => void>();
function setAccountPhoto(next: typeof accountPhoto) {
  accountPhoto = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const useAccountPhoto = () => useSyncExternalStore(subscribe, () => accountPhoto, () => accountPhoto);
/** The address of the signed-in person's photo (uploaded, else Gravatar; 204 draws the initials). */
const accountPhotoSrc = (version: number) => (version ? `/api/avatar?v=${version}` : '/api/avatar');

// `size` picks the initials from the type scale (12 / 14 / 24 px); `className` sets the box.
export function UserAvatar({
  user,
  className,
  size = 'md',
}: {
  user: Pick<DemoUser, 'name' | 'avatar' | 'importedAvatar'>;
  className?: string;
  size?: 'xs' | 'md' | 'lg';
}) {
  const photo = useAccountPhoto();
  const classes = cn(
    'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
    size === 'lg' ? 'text-title' : size === 'xs' ? 'text-caption' : 'text-body',
    className,
  );
  return (
    <AccountAvatar
      name={user.name}
      src={user.avatar?.preview || (user.importedAvatar ? accountPhotoSrc(photo.version) : photo.preview) || null}
      className={classes}
    />
  );
}

async function decodeImage(source: string) {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  return { element, context };
}

async function readAvatar(file: File): Promise<Avatar> {
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeImage(url);
    if (
      image.naturalWidth < 32 ||
      image.naturalHeight < 32 ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    ) {
      throw new Error('Invalid dimensions');
    }
    const scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const { element, context } = canvas(width, height);
    context.drawImage(image, 0, 0, width, height);
    return {
      source: element.toDataURL('image/webp', 0.9),
      preview: '',
      width,
      height,
      zoom: 1,
      x: 50,
      y: 50,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The framed square at 256px: the image the app keeps (WebP; PNG where the browser cannot write WebP, as Safari). */
async function cropAvatar(draft: Avatar): Promise<{ avatar: Avatar; blob: Blob }> {
  const image = await decodeImage(draft.source);
  const size = Math.min(draft.width, draft.height) / draft.zoom;
  const { element, context } = canvas(256, 256);
  context.drawImage(
    image,
    ((draft.width - size) * draft.x) / 100,
    ((draft.height - size) * draft.y) / 100,
    size,
    size,
    0,
    0,
    256,
    256,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    element.toBlob((value) => (value ? resolve(value) : reject(new Error('Canvas unavailable'))), 'image/webp', 0.9),
  );
  return { avatar: { ...draft, preview: element.toDataURL('image/webp', 0.9) }, blob };
}

/** How much wider and taller than the circle the framed image is (1 when a side fits it exactly). */
function overflow(draft: Avatar) {
  const side = Math.min(draft.width, draft.height);
  return { width: (draft.width / side) * draft.zoom, height: (draft.height / side) * draft.zoom };
}

function cropStyle(draft: Avatar): CSSProperties {
  const { width, height } = overflow(draft);
  return {
    position: 'absolute',
    maxWidth: 'none',
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    left: `${(1 - width) * draft.x}%`,
    top: `${(1 - height) * draft.y}%`,
  };
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
/** Moves the framing by a distance in the circle's own share (a drag of the whole circle is 1). */
function moved(draft: Avatar, dx: number, dy: number): Avatar {
  const { width, height } = overflow(draft);
  return {
    ...draft,
    x: width > 1 ? clamp(draft.x - (dx * 100) / (width - 1)) : draft.x,
    y: height > 1 ? clamp(draft.y - (dy * 100) / (height - 1)) : draft.y,
  };
}

async function sendPhoto(method: 'PUT' | 'DELETE', blob?: Blob) {
  const response = await fetch('/api/avatar', {
    method,
    cache: 'no-store',
    ...(blob ? { body: blob, headers: { 'Content-Type': blob.type } } : {}),
  });
  if (response.ok) return;
  const error = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(error?.error || '');
}

/**
 * The profile photo (Settings > My profile): the photo beside the name and email, with Upload or Change and Remove, and the crop dialog (drag or the
 * arrow keys to frame it, the zoom slider). The person's own photo is kept by the app (`/api/avatar`, both editions); the
 * demo keeps it in the page only. Catalog: Profile photo in `/design-system`.
 */
export function ProfileAvatar({ name, email, demo = false }: { name: string; email?: string; demo?: boolean }) {
  const copy = useCopy();
  const { number, locale } = useNumbers();
  const photo = useAccountPhoto();
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; size: number } | null>(null);
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Avatar | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Only a photo the person uploaded can be removed here (Gravatar's belongs to Gravatar); unknown until the app answers.
  const [stored, setStored] = useState<boolean | null>(null);
  const uploaded = demo ? !!photo.preview : stored;

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    fetch(accountPhotoSrc(photo.version), { cache: 'no-store', signal: controller.signal })
      .then((response) => setStored(response.headers.get('X-Avatar-Source') === 'upload'))
      .catch(() => undefined);
    return () => controller.abort();
  }, [demo, photo.version]);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  function close() {
    request.current += 1;
    setBusy(false);
    setError('');
    setDraft(null);
    setOpen(false);
  }

  async function choose(file?: File) {
    if (!file) return;
    const version = ++request.current;
    setError('');
    setOpen(true);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(copy('Choose a JPG, PNG or WebP image.', 'Escolha uma imagem JPG, PNG ou WebP.'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(copy('The image must be smaller than 5 MB.', 'A imagem deve ter menos de 5 MB.'));
      return;
    }
    setBusy(true);
    try {
      const avatar = await readAvatar(file);
      if (request.current === version) setDraft(avatar);
    } catch {
      if (request.current === version)
        setError(
          copy(
            'Could not open this image. Use a valid image between 32 pixels and 40 megapixels.',
            'Não foi possível abrir a imagem. Use uma imagem válida entre 32 pixels e 40 megapixels.',
          ),
        );
    } finally {
      if (request.current === version) setBusy(false);
    }
  }

  async function save() {
    if (!draft || busy) return;
    const version = ++request.current;
    setBusy(true);
    setError('');
    try {
      const { avatar, blob } = await cropAvatar(draft);
      if (!demo) await sendPhoto('PUT', blob);
      if (request.current !== version) return;
      setAccountPhoto(demo ? { ...accountPhoto, preview: avatar.preview } : { version: Date.now() });
      close();
    } catch (failure) {
      if (request.current === version) {
        setError(
          (failure instanceof Error && failure.message) ||
            copy('Could not save this photo. Please try another image.', 'Não foi possível salvar a foto. Tente outra imagem.'),
        );
        setBusy(false);
      }
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      if (!demo) await sendPhoto('DELETE');
      setAccountPhoto(demo ? { ...accountPhoto, preview: null } : { version: Date.now() });
    } catch (failure) {
      setError(
        (failure instanceof Error && failure.message) ||
          copy('Could not remove the photo. Please try again.', 'Não foi possível remover a foto. Tente novamente.'),
      );
    } finally {
      setBusy(false);
    }
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (!draft || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, size: event.currentTarget.clientWidth };
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    if (!start || !draft) return;
    setDraft(moved(draft, (event.clientX - start.x) / start.size, (event.clientY - start.y) / start.size));
    drag.current = { ...start, x: event.clientX, y: event.clientY };
  }
  function nudge(event: KeyboardEvent<HTMLElement>) {
    if (!draft || busy) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    setDraft(moved(draft, delta[0], delta[1]));
  }

  const fileField = (
    <input
      ref={fileInput}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="sr-only"
      tabIndex={-1}
      aria-label={copy('Profile photo file', 'Arquivo da foto de perfil')}
      onChange={(event) => {
        void choose(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  return (
    <>
      <div className="flex items-start gap-4">
        <UserAvatar user={{ name, importedAvatar: !demo }} size="lg" className="size-16" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="min-w-0">
            <p className="truncate font-(--weight-label)">{name}</p>
            {email && email !== name && <p className="text-muted-foreground [overflow-wrap:anywhere]">{email}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy && !open} onClick={() => fileInput.current?.click()}>
              {uploaded ? copy('Change photo', 'Trocar foto') : copy('Upload photo', 'Enviar foto')}
            </Button>
            {uploaded && (
              <Button type="button" variant="ghost" pending={busy && !open} pendingLabel={copy('Removing…', 'Removendo…')} onClick={() => void remove()}>
                {copy('Remove', 'Remover')}
              </Button>
            )}
          </div>
          <p className="text-caption text-muted-foreground">
            {copy('JPG, PNG or WebP, up to 5 MB. You frame it before saving.', 'JPG, PNG ou WebP, até 5 MB. Você enquadra antes de salvar.')}
          </p>
          {error && !open && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        {!open && fileField}
      </div>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy('Frame your photo', 'Enquadre sua foto')}</DialogTitle>
            <DialogDescription>
              {copy('Drag the photo or use the arrow keys to move it, and zoom in.', 'Arraste a foto ou use as setas para movê-la, e aproxime.')}
            </DialogDescription>
          </DialogHeader>
          {open && fileField}
          <div className="space-y-5">
            {/* The framing is a control: dragged, or moved with the arrow keys (Shift for bigger steps) once focused. */}
            <button
              type="button"
              className={cn(
                'relative mx-auto block size-48 touch-none overflow-hidden rounded-full bg-muted select-none',
                draft && !busy && 'cursor-grab active:cursor-grabbing',
              )}
              disabled={!draft || busy}
              aria-label={copy('Photo framing: drag it or use the arrow keys', 'Enquadramento da foto: arraste ou use as setas')}
              aria-busy={busy}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={nudge}
            >
              {draft && (
                // eslint-disable-next-line next/no-img-element
                <img src={draft.source} alt="" draggable={false} style={cropStyle(draft)} />
              )}
            </button>
            {draft && (
              <FieldPrimitive.Root className="space-y-3 px-1">
                <div className="flex items-center justify-between gap-3">
                  <FieldPrimitive.Label>{copy('Zoom', 'Zoom')}</FieldPrimitive.Label>
                  <span className="text-muted-foreground tabular-nums">{`${number(draft.zoom, 2)}×`}</span>
                </div>
                <Slider
                  value={[draft.zoom]}
                  min={1}
                  max={3}
                  step={0.05}
                  locale={locale}
                  disabled={busy}
                  onValueChange={(value) => setDraft({ ...draft, zoom: Array.isArray(value) ? value[0] : value })}
                />
              </FieldPrimitive.Root>
            )}
            {busy && !draft && (
              <output className="block text-center text-muted-foreground">{copy('Opening the image…', 'Abrindo a imagem…')}</output>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              {copy('Choose another', 'Escolher outra')}
            </Button>
            <Button type="button" disabled={!draft} pending={busy && !!draft} pendingLabel={copy('Saving…', 'Salvando…')} onClick={() => void save()}>
              {copy('Save photo', 'Salvar foto')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
