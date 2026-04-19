import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./apps/**/*.{ts,tsx}', './packages/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f4f7fb',
          100: '#e8eef6',
          200: '#cbd9ea',
          300: '#9fb8d6',
          400: '#6d91bd',
          500: '#4b729f',
          600: '#385a82',
          700: '#2e496a',
          800: '#243a55',
          900: '#18283d',
          950: '#0d1725',
        },
        teal: {
          50: '#effcf9',
          100: '#d7f6ef',
          200: '#b3eadf',
          300: '#7dd8c9',
          400: '#45bdac',
          500: '#259e91',
          600: '#1d7f76',
          700: '#1c665f',
          800: '#1a514d',
          900: '#183f3d',
          950: '#092625',
        },
        covered: {
          50: '#f0fdf4',
          500: '#22c55e',
          700: '#15803d',
        },
        attention: {
          50: '#fffbeb',
          500: '#f59e0b',
          700: '#b45309',
        },
        deducted: {
          50: '#fef2f2',
          500: '#ef4444',
          700: '#b91c1c',
        },
        info: {
          50: '#effcf9',
          500: '#259e91',
          700: '#1c665f',
        },
      },
    }
  },
  plugins: []
}

export default config

