type BrandLockupProps = {
  className?: string
  compact?: boolean
}

type BrandMarkProps = {
  className?: string
}

export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <svg className={`brand-mark ${className}`} viewBox="0 0 64 64" aria-hidden="true">
      <rect className="brand-mark-frame" x="7" y="7" width="50" height="50" rx="8" />
      <path className="brand-mark-rule" d="M21 16v32M32 14v36M43 16v32" />
      <path className="brand-mark-tide" d="M16 28c5.8-6.5 11.7-6.5 17.5 0s11.7 6.5 17.5 0" />
      <path className="brand-mark-tide brand-mark-tide-soft" d="M16 38c5.8 5.8 11.7 5.8 17.5 0s11.7-5.8 17.5 0" />
      <circle className="brand-mark-seal" cx="48" cy="17" r="3.2" />
    </svg>
  )
}

export function BrandLockup({ className = '', compact = false }: BrandLockupProps) {
  return (
    <div className={`brand-lockup ${compact ? 'brand-lockup-compact' : ''} ${className}`}>
      <BrandMark />
      <div className="min-w-0">
        <div className="brand-name display">汐账</div>
        <div className="brand-subtitle">Tide ledger</div>
      </div>
    </div>
  )
}
