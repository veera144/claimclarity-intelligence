import type { Config } from 'tailwindcss'

import { claimClarityTheme } from '../../tailwind.theme'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/**/*.{ts,tsx}',
  ],
  theme: claimClarityTheme,
  plugins: [],
}

export default config
