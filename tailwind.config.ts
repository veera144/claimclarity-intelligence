import type { Config } from 'tailwindcss'

import { claimClarityTheme } from './tailwind.theme'

const config: Config = {
  content: [
    './apps/web/app/**/*.{ts,tsx}',
    './apps/web/components/**/*.{ts,tsx}',
    './apps/dashboard/app/**/*.{ts,tsx}',
    './apps/dashboard/components/**/*.{ts,tsx}',
    './packages/**/*.{ts,tsx}',
  ],
  theme: claimClarityTheme,
  plugins: []
}

export default config

