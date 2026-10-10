'use client';

import { DETECTOR_OPTIONS, type DetectorKind } from './engines/kinds';

type DetectorSettingsProps = {
  open: boolean;
  kind: DetectorKind;
  loading: boolean;
  compact?: boolean;
  showPanel?: boolean;
  className?: string;
  onToggle: () => void;
  onSelect: (kind: DetectorKind) => void;
};

export default function DetectorSettings({
  open,
  kind,
  loading,
  compact = false,
  showPanel = true,
  className,
  onToggle,
  onSelect,
}: DetectorSettingsProps) {
  const current = DETECTOR_OPTIONS.find((option) => option.id === kind) ?? DETECTOR_OPTIONS[0];
  const others = DETECTOR_OPTIONS.filter((option) => option.id !== kind);
  return (
    <div className={`lod-settings${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`lod-btn export lod-engine-toggle${compact ? ' compact' : ''}${open ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Detection engine, ${current.title}`}
        title="Detection engine"
      >
        {current.title}
      </button>
      {open && showPanel ? (
        <div className="lod-settings-panel" role="menu" aria-label="Other detection engines">
          {others.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className="lod-engine-card"
              onClick={() => onSelect(option.id)}
              disabled={loading}
            >
              {option.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
