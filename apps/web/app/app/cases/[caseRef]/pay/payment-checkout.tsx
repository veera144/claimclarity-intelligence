'use client'

/**
 * @file payment-checkout.tsx
 * @module web/app/app/cases/pay
 *
 * Opens Razorpay checkout and verifies Module 3 report payments.
 *
 * DEPENDENCIES:
 *   - react
 *
 * CALLED BY:
 *   - /apps/web/app/app/cases/[caseRef]/pay/page.tsx
 *
 * CALLS:
 *   - /api/payments/create
 *   - /api/payments/verify
 */

import type { ReactElement } from 'react'
import { useState, useTransition } from 'react'

type RazorpayCheckoutResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: 'INR'
  name: 'ClaimClarity'
  description: 'Claim Analysis Report'
  order_id: string
  theme: {
    color: '#1B4F72'
  }
  modal: {
    ondismiss: () => void
  }
  handler: (response: RazorpayCheckoutResponse) => void
}

type RazorpayInstance = {
  open: () => void
}

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance

type RazorpayWindow = Window &
  typeof globalThis & {
    Razorpay?: RazorpayConstructor
  }

type CreateOrderResponse = {
  orderId: string
  amount: number
  currency: 'INR'
  keyId: string
}

type PaymentCheckoutProps = {
  caseId: string
  caseRef: string
}

let razorpayScriptPromise: Promise<void> | null = null

function isCreateOrderResponse(value: unknown): value is CreateOrderResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const payload = value as Record<string, unknown>
  return (
    typeof payload.orderId === 'string' &&
    typeof payload.amount === 'number' &&
    payload.currency === 'INR' &&
    typeof payload.keyId === 'string'
  )
}

function loadRazorpayScript(): Promise<void> {
  const razorpayWindow = window as RazorpayWindow
  if (razorpayWindow.Razorpay) {
    return Promise.resolve()
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => {
      resolve()
    }
    script.onerror = () => {
      reject(new Error('Unable to load Razorpay checkout'))
    }
    document.body.appendChild(script)
  })

  return razorpayScriptPromise
}

export function PaymentCheckout(props: PaymentCheckoutProps): ReactElement {
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function verifyPayment(response: RazorpayCheckoutResponse): Promise<void> {
    const verifyResponse = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...response,
        caseId: props.caseId,
      }),
    })

    if (!verifyResponse.ok) {
      setMessage('Payment verification failed. Please contact support before trying again.')
      return
    }

    window.location.href = `/app/cases/${props.caseRef}/status`
  }

  function handlePayClick(): void {
    setMessage(null)
    startTransition(() => {
      void (async () => {
        const createResponse = await fetch('/api/payments/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ caseId: props.caseId }),
        })

        const payload = (await createResponse.json().catch(() => null)) as unknown
        if (!createResponse.ok || !isCreateOrderResponse(payload)) {
          setMessage('Payment could not be started. Please try again.')
          return
        }

        try {
          await loadRazorpayScript()
        } catch {
          setMessage('Payment checkout could not be loaded. Please try again.')
          return
        }

        const razorpayWindow = window as RazorpayWindow
        if (!razorpayWindow.Razorpay) {
          setMessage('Payment checkout could not be loaded. Please try again.')
          return
        }

        const checkout = new razorpayWindow.Razorpay({
          key: payload.keyId,
          amount: payload.amount,
          currency: payload.currency,
          name: 'ClaimClarity',
          description: 'Claim Analysis Report',
          order_id: payload.orderId,
          theme: {
            color: '#1B4F72',
          },
          modal: {
            ondismiss: () => {
              setMessage('Payment cancelled. Your documents are saved. Come back any time.')
            },
          },
          handler: (checkoutResponse) => {
            void verifyPayment(checkoutResponse)
          },
        })

        checkout.open()
      })()
    })
  }

  return (
    <div className="mt-8 border-t border-slate-300 pt-6">
      <p className="text-3xl font-semibold text-slate-950">₹699</p>
      <button
        className="mt-4 rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        type="button"
        disabled={isPending}
        onClick={handlePayClick}
      >
        {isPending ? 'Starting payment' : 'Pay ₹699'}
      </button>
      {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
    </div>
  )
}
