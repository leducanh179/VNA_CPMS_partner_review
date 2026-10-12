import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'vna-blue': '#005f6b',
        'vna-blue-deep': '#003f4a',
        'vna-gold': '#d7aa38',
        'vna-gold-dark': '#9b7412',
      },
      boxShadow: {
        panel: '0 24px 60px -32px rgba(0, 63, 74, 0.28)',
      },
    },
  },
  plugins: [],
} satisfies Config;
