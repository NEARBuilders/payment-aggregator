# 002-02: Generic Payment UI

### Context

This ticket depends on 002-01 (Aggregator API + Provider Discovery). With the generic API endpoints available, build a `/payments` page that queries provider metadata from `GET /api/payments/providers`, renders provider cards with logos, and lets users test the full payment flow: create checkout sessions, view session status, and simulate webhooks — all without any hardcoded provider references.

Add a "Payments" link to the home page (`index.tsx`) floating skill assistant.

### Overview

1. Create `ui/src/routes/_layout/_authenticated/payments.tsx` as an authenticated route
2. Provider selection screen — queries `paymentProviders()`, renders grid of cards
3. Checkout form — user fills in order details, receives session URL
4. Session viewer — enter session ID, see status and details
5. Webhook simulator — select event type, auto-generate signature, receive parsed result
6. Add "Payments" link to `ui/src/routes/_layout/index.tsx`

### Files to Create

| File | Purpose |
|------|---------|
| `ui/src/routes/_layout/_authenticated/payments.tsx` | Main payments page with all three flow states |

### Files to Modify

| File | Change |
|------|--------|
| `ui/src/routes/_layout/index.tsx` | Add "Payments" button to `FloatingSkillAssistant` grid |

### Route Structure

File path `_layout/_authenticated/payments.tsx` maps to URL `/payments`. It is inside the `_authenticated` layout, so only logged-in users can access it — matching the existing `home.tsx` and `settings.tsx` pattern.

### Component States

The page has three visual states, managed by a `step` state variable:

#### State 1: Provider Selection (`step === 'providers'`)

```typescript
const { data: providers } = useQuery({
  queryKey: ['payment-providers'],
  queryFn: () => apiClient.paymentProviders(),
});
```

Renders a responsive grid of cards. Each card shows:
- `<img src={provider.logo} />` — the provider's logo
- Provider `name` as heading
- Provider `description` as body text
- "Test Provider" button → sets `selectedProvider = provider.key`, transitions to `step = 'checkout'`

Uses semantic Tailwind classes (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`). Card hover effect via `hover:shadow-md transition-shadow`.

#### State 2: Checkout Form (`step === 'checkout'`)

Displays the selected provider's name/logo at top. Form fields:
- `orderId` — text input, required
- `amount` — number input (positive), required
- `currency` — text input, defaults to `"USD"`
- `customerEmail` — email input, optional
- `successUrl` — URL input, defaults to current origin or a placeholder
- `cancelUrl` — URL input, defaults to current origin or a placeholder
- `items` — simple text area (one per line: `name,unitAmount,quantity`) or structured input

On submit, calls:

```typescript
const result = await apiClient.paymentCheckout({
  provider: selectedProvider,
  orderId,
  amount: Number(amount),
  currency,
  customerEmail: customerEmail || undefined,
  successUrl,
  cancelUrl,
  items: [{ name: items, unitAmount: Number(amount), quantity: 1 }],
});
```

On success, stores `sessionId` and `checkoutUrl` in state, transitions to `step = 'session'`.

Error state shows inline via `useMutation` error handler.

#### State 3: Session Viewer + Webhook Simulator (`step === 'session'`)

Shows the checkout result:
- Session ID (monospace, copyable)
- Checkout URL (clickable link, opens in new tab)
- "View Session Status" button to manually refresh

Session status query:

```typescript
const { data: sessionData } = useQuery({
  queryKey: ['payment-session', selectedProvider, sessionId],
  queryFn: () => apiClient.paymentSession({ provider: selectedProvider, sessionId }),
  enabled: !!sessionId,
});
```

Renders session details: `id`, `status`, `paymentStatus`, `amountTotal`, `currency`, `metadata` as a key-value table.

**Webhook Simulator:**

A collapsible section (or always visible card). Contains:
- Event type dropdown: `payment.success`, `payment.failed`, `checkout.session.completed`
- Order ID input (auto-filled from `orderId`)
- "Simulate Webhook" button

On click, generates a webhook payload with the selected event type, computes an HMAC-SHA256 signature using a test secret (`test_webhook_secret` for PingPay, mock for Stripe), and calls:

```typescript
const webhookResult = await apiClient.paymentWebhook({
  provider: selectedProvider,
  body: JSON.stringify(payload),
  signature: computedSignature,
  timestamp: String(Math.floor(Date.now() / 1000)),
});
```

Displays the parsed webhook result: `received`, `eventType`, `orderId`, `sessionId`.

A "Back to Providers" button at the top of each state navigates back to the grid.

### Index Page Link (`ui/src/routes/_layout/index.tsx`)

Add one row to the `FloatingSkillAssistant` grid (inside the `open &&` motion div, alongside Skill/Report/About/Copy buttons). Using `Link` with `preload="intent"`:

```tsx
<Button variant="outline" asChild className="justify-start">
  <Link to="/payments" preload="intent" onClick={() => setOpen(false)}>
    <Sparkles size={14} />
    Payments
  </Link>
</Button>
```

This lets unauthenticated users navigate to `/payments` (they'll be redirected to login by the `_authenticated` layout guard).

### API Client Usage

The UI uses `apiClient` from `useApiClient()` (via `@/app`). The `ApiContract` type is generated from `api/src/contract.ts`. After 002-01 changes the contract, `api-types.gen.ts` will need regeneration for the UI to have typed access to `paymentProviders`, `paymentCheckout`, `paymentWebhook`, and `paymentSession`.

If types are not yet regenerated, use:

```typescript
const apiClient = useApiClient();
// Temporary: access new routes as any until api-types.gen.ts is regenerated
const providers = await (apiClient as any).paymentProviders();
```

### Acceptance Criteria
- [ ] `ui/src/routes/_layout/_authenticated/payments.tsx` exists and renders at `/payments`
- [ ] Provider selection grid shows cards with logo, name, description for each registered provider
- [ ] Clicking "Test Provider" transitions to checkout form with that provider's name visible
- [ ] Checkout form submits to `paymentCheckout` with `{ provider, ... }` in the body
- [ ] Successful checkout shows session ID, URL link, and transition to session viewer
- [ ] Session viewer queries `paymentSession` and displays status, paymentStatus, amount, currency
- [ ] Webhook simulator generates a webhook payload with HMAC-SHA256 signature and calls `paymentWebhook`
- [ ] Webhook result (received, eventType, orderId) is displayed
- [ ] "Back to Providers" navigation returns to the provider grid
- [ ] "Payments" link appears in `index.tsx` FloatingSkillAssistant grid
- [ ] Zero hardcoded provider names in the UI code (all from metadata)
- [ ] `bun typecheck` passes in `ui/`
- [ ] `bun lint` passes in `ui/`

### Notes
- [ ] Follow existing component patterns: same Tailwind classes, same semantic naming, no hardcoded colors
- [ ] Use `useMutation` for checkout and webhook calls (mutations), `useQuery` for provider list and session status (queries)
- [ ] The webhook simulator uses a hardcoded test HMAC secret — this is fine for development/testing. The real webhook URL (on the server) uses the actual secret from env
- [ ] If `api-types.gen.ts` hasn't been regenerated after 002-01 contract changes, use `(apiClient as any)` for the new procedures — add a note to regenerate types before merging
- [ ] The `items` field can be simplified for the test UI (single item derived from amount, or a basic line-item editor)
- [ ] No hardcoded PingPay/Stripe specifics in the UI — all fields come from the generic `CheckoutSessionInputSchema`
