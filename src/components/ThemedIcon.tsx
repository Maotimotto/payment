export type ThemedIconName =
  | 'overview'
  | 'import'
  | 'transactions'
  | 'tags'
  | 'settings'
  | 'vault'
  | 'bank'
  | 'image'
  | 'manual'

type ThemedIconProps = {
  name: ThemedIconName
  className?: string
}

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function paths(name: ThemedIconName) {
  switch (name) {
    case 'overview':
      return (
        <>
          <path {...line} d="M4 17.5h16" />
          <path {...line} d="M6.5 14.5c2.8-5.2 5.6-5.2 8.4 0 1.7 3.1 3.1 3.1 4.6 0" />
          <path {...line} d="M6 6.5h4.8M6 9.5h3.3" />
        </>
      )
    case 'import':
      return (
        <>
          <path {...line} d="M4 7.5h4.5c2.2 0 3.4 1.1 4.7 3.4l.6 1.1c1.2 2.3 2.5 3.4 4.7 3.4H20" />
          <path {...line} d="M16.8 12.1 20 15.4l-3.2 3.2" />
          <path {...line} d="M4 16.5h4.7c1.4 0 2.5-.4 3.4-1.4" />
        </>
      )
    case 'transactions':
      return (
        <>
          <path {...line} d="M5 6h14M5 12h14M5 18h14" />
          <path {...line} d="M7.5 4.2v3.6M16.5 10.2v3.6M10.5 16.2v3.6" />
        </>
      )
    case 'tags':
      return (
        <>
          <path {...line} d="M5.2 5.2h7.2l6.4 6.4a2.3 2.3 0 0 1 0 3.3l-3.9 3.9a2.3 2.3 0 0 1-3.3 0l-6.4-6.4V5.2Z" />
          <circle cx="8.8" cy="8.8" r="1.2" fill="currentColor" />
        </>
      )
    case 'settings':
      return (
        <>
          <circle {...line} cx="12" cy="12" r="3.1" />
          <path {...line} d="M12 3.8v2.1M12 18.1v2.1M20.2 12h-2.1M5.9 12H3.8M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5M17.8 17.8l-1.5-1.5M7.7 7.7 6.2 6.2" />
        </>
      )
    case 'vault':
      return (
        <>
          <rect {...line} x="5" y="9.5" width="14" height="10" rx="2" />
          <path {...line} d="M8.5 9.5V7.8a3.5 3.5 0 0 1 7 0v1.7" />
          <circle cx="12" cy="14.5" r="1.4" fill="currentColor" />
        </>
      )
    case 'bank':
      return (
        <>
          <path {...line} d="m4 9 8-4 8 4" />
          <path {...line} d="M5.5 10.8h13M7 10.8v6M12 10.8v6M17 10.8v6M5 18.8h14" />
        </>
      )
    case 'image':
      return (
        <>
          <rect {...line} x="4.5" y="5" width="15" height="14" rx="2" />
          <path {...line} d="m6.8 16 3.5-4 2.7 2.9 1.8-1.9 2.9 3" />
          <circle cx="15.6" cy="9" r="1.3" fill="currentColor" />
        </>
      )
    case 'manual':
      return (
        <>
          <path {...line} d="M7 5.2h7.4l2.6 2.6v11H7z" />
          <path {...line} d="M14.2 5.2V8h2.8M9.7 12h4.6M9.7 15.2h3" />
          <path {...line} d="m16 14.5 2.7 2.7M18.7 14.5 16 17.2" />
        </>
      )
  }
}

export function ThemedIcon({ name, className = '' }: ThemedIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {paths(name)}
    </svg>
  )
}
