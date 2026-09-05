'use client';
import { Aperture } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
export default function Loading() {
  const { locale } = useI18n();
  return (
    <main className="loading-page">
      <output className="flex items-center gap-2.5">
        <Aperture className="animate-spin" />
        <span>
          {locale === 'en' ? 'Loading Lastfind…' : 'Carregando Lastfind…'}
        </span>
      </output>
    </main>
  );
}
