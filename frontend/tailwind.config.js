/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          bg: '#0f1419',
          secondary: '#1a1f2e',
          tertiary: '#252b3b',
        },
        panel: {
          bg: '#1a1f2e',
          border: '#2a3142',
        },
        content: {
          bg: '#0f1419',
        },
        text: {
          primary: '#e6e8ec',
          secondary: '#a1a8b8',
          muted: '#6b7280',
        },
        accent: {
          primary: '#3b82f6',
          hover: '#2563eb',
          active: '#1d4ed8',
        },
        border: '#2a3142',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
      },
      boxShadow: {
        panel: '2px 0 12px rgba(0, 0, 0, 0.5)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [
    function({ addUtilities }) {
      addUtilities({
        '.glass': {
          'background': 'rgba(30, 30, 50, 0.35)',
          'backdrop-filter': 'blur(12px) saturate(180%)',
          '-webkit-backdrop-filter': 'blur(12px) saturate(180%)',
          'border': '1px solid rgba(255, 255, 255, 0.08)',
          'border-radius': '16px',
          'box-shadow': '0 8px 32px rgba(0, 0, 0, 0.35)',
        },
      });
    },
  ],
}