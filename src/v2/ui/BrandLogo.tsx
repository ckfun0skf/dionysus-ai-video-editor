/**
 * P59: Dionysus brand mark — a single-colour silhouette (grape cluster + play cue).
 * Uses fill="currentColor" only so it works in any colour and reversed.
 */
export function BrandLogo({ size = 22, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title ? <title>{title}</title> : null}
      {/* leaf */}
      <path d="M13.15 2.35c1.55-.15 2.85 1.05 2.7 2.45-1.35-.15-2.45-.85-2.7-2.45Z" />
      <path d="M12.15 4.2c.12 1.15-.55 2.05-1.55 2.15.05-1.2.7-2.05 1.55-2.15Z" />
      {/* grape cluster */}
      <circle cx="12" cy="7.15" r="2.15" />
      <circle cx="9.15" cy="10.05" r="2.2" />
      <circle cx="14.85" cy="10.05" r="2.2" />
      <circle cx="10.35" cy="13.25" r="2.15" />
      <circle cx="13.65" cy="13.25" r="2.15" />
      {/* play / theatre cue */}
      <path d="M9.7 16.85v5.05l7.15-2.52Z" />
    </svg>
  );
}

/** Inline SVG markup for favicon / standalone renders (explicit colours). */
export function brandLogoMarkup(fill = "currentColor"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}"><path d="M13.15 2.35c1.55-.15 2.85 1.05 2.7 2.45-1.35-.15-2.45-.85-2.7-2.45Z"/><path d="M12.15 4.2c.12 1.15-.55 2.05-1.55 2.15.05-1.2.7-2.05 1.55-2.15Z"/><circle cx="12" cy="7.15" r="2.15"/><circle cx="9.15" cy="10.05" r="2.2"/><circle cx="14.85" cy="10.05" r="2.2"/><circle cx="10.35" cy="13.25" r="2.15"/><circle cx="13.65" cy="13.25" r="2.15"/><path d="M9.7 16.85v5.05l7.15-2.52Z"/></svg>`;
}
