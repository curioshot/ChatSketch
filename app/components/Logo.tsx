// ChatSketch mark: chat bubble with a sketch stroke inside
export default function Logo({
  size = 32,
  animated = false,
  className = "",
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  // stroke draw effect for the splash screen
  const draw = animated
    ? { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1, className: "chatsketch-draw" }
    : {};
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="ChatSketch logo"
    >
      <rect x={8} y={8} width={48} height={34} rx={10} {...draw} style={animated ? { animationDelay: "0s" } : undefined} />
      <path d="M22 42v9l9-9" {...draw} style={animated ? { animationDelay: "0.5s" } : undefined} />
      <path d="M20 25c5-6 9 3 14-2s7 4 10 1" {...draw} style={animated ? { animationDelay: "0.9s" } : undefined} />
    </svg>
  );
}
