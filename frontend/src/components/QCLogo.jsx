// The QualChek mark.
//
// A check stroke drawn inside a bracket - the bracket for "this is code", the
// check for "it passed". Both are drawn as strokes on a 32x32 grid with round
// caps and joins, so the mark holds up at favicon size as well as it does on
// the sign-in panel.
//
// currentColor on the bracket and an explicit accent on the check, so the mark
// sits correctly on a light panel, on the dark sign-in panel, and in a
// single-colour context (pass accent="currentColor").
export default function QCLogo({ className = '', accent = '#38c2b2', title = 'QualChek' }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      {/* Left and right brackets, suggesting a block of code under inspection. */}
      <path
        d="M11 4 H6 a2 2 0 0 0 -2 2 v20 a2 2 0 0 0 2 2 h5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 4 h5 a2 2 0 0 1 2 2 v20 a2 2 0 0 1 -2 2 h-5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The check. Deliberately overshoots the brackets' inner edge so the
          mark reads as one gesture rather than three separate strokes. */}
      <path
        d="M10 16.5 L14.5 21 L23 11"
        stroke={accent}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
