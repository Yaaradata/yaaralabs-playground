type IconProps = {
  className?: string;
};

const stroke = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className} fill="currentColor" stroke="none">
      <path d="M8 5.2v13.6L19.2 12 8 5.2z" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function ExpandIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

export function CompressIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9 3v6H3" />
      <path d="M15 21v-6h6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

export function FlipIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
      <path d="M12 2v2" />
      <path d="M12 8v2" />
      <path d="M12 14v2" />
      <path d="M12 20v2" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className} width="22" height="22" strokeWidth="2.75">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
