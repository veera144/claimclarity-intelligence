import type { Metadata } from 'next'
import type { ReactElement, ReactNode } from 'react'

import { DashboardHeader } from '../components/DashboardHeader'

import './globals.css'

export const metadata: Metadata = {
  title: 'ClaimClarity Dashboard',
  description: 'ClaimClarity internal dashboard infrastructure scaffold'
}

export default async function RootLayout({
  children
}: Readonly<{
  children: ReactNode
}>): Promise<ReactElement> {
  const header = await DashboardHeader()

  return (
    <html lang="en">
      <body>
        {header}
        {children}
      </body>
    </html>
  )
}
