import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@claimclarity/db', '@claimclarity/shared']
}

export default nextConfig

