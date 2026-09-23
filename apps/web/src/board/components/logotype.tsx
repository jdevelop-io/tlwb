const SIZES = {
  editor: {
    font: 24,
    line: 26,
    width: 42,
    height: 5,
    path: 'M2 3.4 C 12 1.4, 22 3.8, 40 1.8',
    stroke: 2.2,
  },
  sidebar: {
    font: 26,
    line: 26,
    width: 44,
    height: 6,
    path: 'M1.5 4 C 11.5 1.8, 22.5 4.8, 42.5 2.5',
    stroke: 2,
  },
  nav: {
    font: 34,
    line: 34,
    width: 60,
    height: 8,
    path: 'M2 5.5 C 16 2.5, 31 6.5, 58 3.5',
    stroke: 3,
  },
  footer: {
    font: 26,
    line: 26,
    width: 46,
    height: 7,
    path: 'M2 4.5 C 12 2, 24 5.5, 44 3',
    stroke: 2.5,
  },
} as const

export function Logotype(props: { size: keyof typeof SIZES; href?: string }) {
  const size = SIZES[props.size]
  const content = (
    <>
      <span style={{ fontSize: size.font, lineHeight: `${size.line}px` }}>
        tlwb
      </span>
      <svg
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        aria-hidden="true"
      >
        <path
          d={size.path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={size.stroke}
          strokeLinecap="round"
        />
      </svg>
    </>
  )
  return props.href ? (
    <a href={props.href} className="logotype">
      {content}
    </a>
  ) : (
    <span className="logotype">{content}</span>
  )
}
