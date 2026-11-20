import React, { useState } from 'react';

export const TIGER_LOGO_URL = '/src/assets/images/tiger_brand_logo_1795106934004.jpg';
export const TIGER_HERO_URL = '/src/assets/images/tiger_hero_banner_1795106935550.jpg';
export const TIGER_DEFAULT_COVER = '/src/assets/images/tiger_default_cover_1795106934343.jpg';
export const TIGER_AI_AVATAR = '/src/assets/images/tiger_ai_avatar_1795106933901.jpg';

export const BrandMark: React.FC<{ size?: 'sm' | 'md' | 'lg'; showText?: boolean }> = ({
  size = 'md',
  showText = true,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const boxSize = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-14 h-14' : 'w-9 h-9';
  const textSize = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-xl';

  return (
    <div className="inline-flex items-center gap-2.5 shrink-0 select-none">
      <div
        className={`${boxSize} rounded-xl overflow-hidden bg-black border border-orange-500/40 flex items-center justify-center shrink-0`}
      >
        {!imgFailed ? (
          <img
            src={TIGER_LOGO_URL}
            alt="TIGER Logo"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="font-display font-extrabold text-orange-500 text-sm">T</span>
        )}
      </div>
      {showText && (
        <span
          className={`font-display font-extrabold tracking-tight text-zinc-950 dark:text-white whitespace-nowrap ${textSize}`}
        >
          TIGER
        </span>
      )}
    </div>
  );
};

export const UserAvatar: React.FC<{
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
}> = ({ src, name, size = 'md', isOnline }) => {
  const [failed, setFailed] = useState(false);
  const dims =
    size === 'xs'
      ? 'w-7 h-7 text-xs'
      : size === 'sm'
      ? 'w-9 h-9 text-xs'
      : size === 'lg'
      ? 'w-14 h-14 text-lg'
      : size === 'xl'
      ? 'w-24 h-24 text-2xl'
      : 'w-10 h-10 text-sm';

  const initials = (name || 'T').trim().slice(0, 2).toUpperCase();

  return (
    <div className="relative inline-block shrink-0">
      <div
        className={`${dims} rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 flex items-center justify-center font-bold text-zinc-800 dark:text-zinc-100`}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      {isOnline && (
        <span
          title="Online"
          className="absolute bottom-0 end-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950"
        />
      )}
    </div>
  );
};
