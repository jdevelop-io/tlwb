export function AgentIcon(props: {
  size: number
  color?: string
  strokeWidth?: number
}) {
  const stroke = props.color ?? 'currentColor'
  const width = props.strokeWidth ?? 1.5
  const common = {
    fill: 'none',
    stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="9"
        width="14"
        height="10"
        rx="2.5"
        strokeWidth={width}
        {...common}
      />
      <path d="M12 5v4" strokeWidth={width} {...common} />
      <circle cx="12" cy="4" r="1" strokeWidth={width} {...common} />
      <path d="M9.5 14h.01M14.5 14h.01" strokeWidth={width + 0.5} {...common} />
    </svg>
  )
}
