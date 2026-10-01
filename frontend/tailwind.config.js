// QualChek brand palette.
//
// Deliberately far from the red this codebase started with: a QA tool spends
// most of its screen area reporting pass and fail, and a red primary competes
// with the one colour that has to mean "failed". Teal carries the brand,
// amber and rose are left free to mean something.
//
// 600 and 700 hold the primary/hover pair, so the existing
// `bg-brand-600 hover:bg-brand-700` buttons land on brand without edits.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Space Grotesk for headings has the slightly technical, drawn feel the
        // name wants; Inter carries the dense tables and forms.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50:  '#eefbf8',
          100: '#d2f5ee',
          200: '#a8ebdf',
          300: '#71dbcc',
          400: '#38c2b2',
          500: '#19a699',
          600: '#0d8a80',   // primary
          700: '#0b6e68',   // pressed / hover
          800: '#0d5753',
          900: '#0e4845',
        },
        // Secondary, for accents and charts that must not read as a status.
        indigo2: {
          50:  '#eef1ff',
          100: '#e0e5ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        // The dark panel on the sign-in screen and the app shell.
        slate2: { deep: '#0a1420', panel: '#0f1b2a' },
        // Status colours, kept away from the brand hue on purpose.
        pass: { 500: '#16a34a', 50: '#f0fdf4' },
        fail: { 500: '#e11d48', 50: '#fff1f3' },
        warn: { 500: '#d97706', 50: '#fffbeb' },
        ink: {
          400: '#94a3b8',
          600: '#475569',
          900: '#0f172a',
        },
      },
    },
  },
  plugins: [],
};
