'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { ImagePlus, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
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

type Avatar = NonNullable<DemoUser['avatar']>;

export function UserAvatar({
  user,
  className,
}: {
  user: Pick<DemoUser, 'name' | 'avatar'>;
  className?: string;
}) {
  const classes = cn(
    'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium',
    className,
  );
  return user.avatar ? (
    // Local, bounded image data never goes through the image optimization server.
    // eslint-disable-next-line next/no-img-element
    <img
      src={user.avatar.preview}
      alt=""
      width={32}
      height={32}
      className={classes}
    />
  ) : (
    <span aria-hidden="true" className={classes}>
      {user.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase()}
    </span>
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

async function cropAvatar(draft: Avatar): Promise<Avatar> {
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
  return { ...draft, preview: element.toDataURL('image/webp', 0.9) };
}

function cropStyle(draft: Avatar): CSSProperties {
  const side = Math.min(draft.width, draft.height);
  const width = (draft.width / side) * draft.zoom;
  const height = (draft.height / side) * draft.zoom;
  return {
    position: 'absolute',
    maxWidth: 'none',
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    left: `${(1 - width) * draft.x}%`,
    top: `${(1 - height) * draft.y}%`,
  };
}

export function ProfileAvatar({
  user,
  onSave,
}: {
  user: DemoUser;
  onSave: (avatar: DemoUser['avatar']) => void;
}) {
  const copy = useCopy();
  const { number, locale } = useNumbers();
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Avatar | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  function setEditorOpen(next: boolean) {
    request.current += 1;
    setBusy(false);
    setError('');
    setDraft(next ? (user.avatar ?? null) : null);
    setOpen(next);
  }

  async function upload(file?: File) {
    if (!file) return;
    const version = ++request.current;
    setError('');
    setBusy(false);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(
        copy(
          'Choose a JPG, PNG or WebP image.',
          'Escolha uma imagem JPG, PNG ou WebP.',
        ),
      );
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(
        copy(
          'The image must be smaller than 5 MB.',
          'A imagem deve ter menos de 5 MB.',
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const avatar = await readAvatar(file);
      if (request.current === version) setDraft(avatar);
    } catch {
      if (request.current === version) {
        setError(
          copy(
            'Could not open this image. Use a valid image between 32 pixels and 40 megapixels.',
            'Não foi possível abrir a imagem. Use uma imagem válida entre 32 pixels e 40 megapixels.',
          ),
        );
      }
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
      const avatar = await cropAvatar(draft);
      if (request.current !== version) return;
      onSave(avatar);
      setEditorOpen(false);
    } catch {
      if (request.current === version) {
        setError(
          copy(
            'Could not save this photo. Please try another image.',
            'Não foi possível salvar a foto. Tente outra imagem.',
          ),
        );
        setBusy(false);
      }
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar user={user} className="size-16 text-lg" />
        <div className="min-w-0 space-y-2.5">
          <p className="text-sm font-medium">
            {copy('Profile photo', 'Foto de perfil')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditorOpen(true)}
            >
              {user.avatar ? <Pencil size={13} /> : <Upload size={13} />}
              {user.avatar
                ? copy('Edit photo', 'Editar foto')
                : copy('Add photo', 'Adicionar foto')}
            </Button>
            {user.avatar && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onSave(undefined)}
              >
                <Trash2 size={13} />
                {copy('Remove', 'Remover')}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {copy(
              'JPG, PNG or WebP. Up to 5 MB.',
              'JPG, PNG ou WebP. Até 5 MB.',
            )}
          </p>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {copy('Edit profile photo', 'Editar foto de perfil')}
            </DialogTitle>
            <DialogDescription className="pr-4 text-sm leading-relaxed">
              {copy(
                'Choose a photo and adjust its framing.',
                'Escolha uma foto e ajuste o enquadramento.',
              )}
            </DialogDescription>
          </DialogHeader>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label={copy('Profile photo file', 'Arquivo da foto de perfil')}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <div className="space-y-5">
            <figure
              className="relative mx-auto size-44 overflow-hidden rounded-full bg-muted/50"
              aria-label={copy(
                'Profile photo preview',
                'Prévia da foto de perfil',
              )}
            >
              {draft ? (
                // eslint-disable-next-line next/no-img-element
                <img
                  src={draft.source}
                  alt=""
                  draggable={false}
                  style={cropStyle(draft)}
                />
              ) : (
                <ImagePlus className="absolute inset-0 m-auto size-9 text-muted-foreground/50" />
              )}
            </figure>
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={13} />
                {copy('Choose image', 'Escolher imagem')}
              </Button>
              {draft && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={copy('Reset framing', 'Redefinir enquadramento')}
                  onClick={() => setDraft({ ...draft, zoom: 1, x: 50, y: 50 })}
                >
                  <RotateCcw size={14} />
                </Button>
              )}
            </div>
            {draft && (
              <div className="space-y-5 px-1">
                {(
                  [
                    {
                      key: 'zoom',
                      label: copy('Zoom', 'Zoom'),
                      min: 1,
                      max: 3,
                      step: 0.05,
                    },
                    {
                      key: 'x',
                      label: copy('Horizontal position', 'Posição horizontal'),
                      min: 0,
                      max: 100,
                      step: 1,
                    },
                    {
                      key: 'y',
                      label: copy('Vertical position', 'Posição vertical'),
                      min: 0,
                      max: 100,
                      step: 1,
                    },
                  ] as const
                ).map(({ key, label, min, max, step }) => (
                  <FieldPrimitive.Root key={key} className="space-y-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <FieldPrimitive.Label>{label}</FieldPrimitive.Label>
                      <span className="text-muted-foreground">
                        {key === 'zoom'
                          ? `${number(draft[key], 2)}×`
                          : `${number(draft[key])}%`}
                      </span>
                    </div>
                    <Slider
                      value={[draft[key]]}
                      min={min}
                      max={max}
                      step={step}
                      locale={locale}
                      disabled={busy}
                      onValueChange={(value) =>
                        setDraft({
                          ...draft,
                          [key]: Array.isArray(value) ? value[0] : value,
                        })
                      }
                    />
                  </FieldPrimitive.Root>
                ))}
              </div>
            )}
            {busy && (
              <output className="text-center text-sm text-muted-foreground">
                {copy('Processing image…', 'Processando imagem…')}
              </output>
            )}
            {error && (
              <p
                role="alert"
                className="text-sm leading-relaxed text-destructive"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditorOpen(false)}
            >
              {copy('Cancel', 'Cancelar')}
            </Button>
            <Button
              type="button"
              disabled={!draft || busy}
              onClick={() => void save()}
            >
              {copy('Save photo', 'Salvar foto')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
