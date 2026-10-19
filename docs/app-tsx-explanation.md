# `App.tsx` — Complete Engineering Walkthrough

This document explains the complete [`client/src/App.tsx`](../client/src/App.tsx) file: what each section does, how data moves through it, how React decides what to display, and how an engineer would evaluate the design.

## What the file does

`App.tsx` implements the entire customer-facing booking flow:

1. Fetch the available appointment slots.
2. Display them chronologically.
3. Let the customer select a slot.
4. Collect the customer's name and email.
5. Submit the booking to the API.
6. Handle validation errors, stale slots, and booking conflicts.
7. Show a confirmation and refresh the remaining slots.

The overall flow is:

```text
Page mounts
    ↓
GET /api/slots
    ↓
Display available slots
    ↓
User selects a slot
    ↓
Display booking form
    ↓
Validate name and email
    ↓
POST /api/bookings
    ├─ Success → confirmation + refresh slots
    ├─ 400 → invalid details
    ├─ 404 → slot disappeared + refresh slots
    ├─ 409 → someone else booked it + refresh slots
    └─ Other → generic failure
```

## 1. Imports

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { Route, Routes } from "react-router-dom";
import axios from "axios";
```

### React imports

- `useState` stores values that change while the user interacts with the page.
- `useEffect` performs the initial API request after the component mounts.
- `FormEvent` is the TypeScript type for a form-submission event.

The `type` keyword means that `FormEvent` is only used by TypeScript. It is removed from the compiled JavaScript and does not add anything to the browser bundle.

### Router imports

`Routes` and `Route` connect the booking page to the `/` URL. There is currently one route, but the routing structure allows more pages to be added later.

### Axios

Axios makes the two HTTP requests used by this page:

```text
GET  /api/slots
POST /api/bookings
```

During local development, Vite proxies `/api` requests to the Express server on port `5000`. That is configured in [`client/vite.config.ts`](../client/vite.config.ts).

## 2. Data types

### `Slot`

```tsx
type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
  tenantName: string;
};
```

This describes one object returned by `GET /api/slots`.

```json
{
  "id": "slot-id",
  "startsAt": "2026-10-12T03:30:00.000Z",
  "endsAt": "2026-10-12T04:00:00.000Z",
  "tenantName": "Demo Studio"
}
```

- `id` identifies the slot when creating a booking.
- `startsAt` and `endsAt` arrive as JSON strings rather than JavaScript `Date` objects.
- `tenantName` is the business offering the slot.

### `BookingConfirmation`

```tsx
type BookingConfirmation = {
  id: string;
  startsAt: string;
  endsAt: string;
  guestName: string;
  guestEmail: string;
};
```

This represents the information the UI needs after a successful booking.

It is not exactly the server response. The server returns the booking ID, slot ID, and times, while the client already knows the customer's normalized name and email. The client combines those values to create a complete confirmation object.

These TypeScript types only provide compile-time checking. They do not validate data at runtime. If the API returned malformed JSON, the Axios generic would not detect that by itself.

## 3. Formatting a slot

```tsx
function formatSlot(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
```

The API returns ISO date strings. The helper turns them into JavaScript `Date` objects.

It formats the date:

```tsx
const day = start.toLocaleDateString(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
```

Passing `undefined` as the locale tells the browser to use the user's configured locale.

It separately formats the time range:

```tsx
const time = `${start.toLocaleTimeString(undefined, {
  hour: "numeric",
  minute: "2-digit",
})} – ${end.toLocaleTimeString(undefined, {
  hour: "numeric",
  minute: "2-digit",
})}`;
```

It returns two pieces:

```tsx
return { day, time };
```

Keeping the date and time separate lets the UI display them on separate lines.

### Time-zone behavior

No explicit `timeZone` option is supplied, so the visitor's browser time zone controls the displayed time. A production scheduling application should deliberately decide whether appointments are shown in the customer's time zone, the business's time zone, or both.

## 4. Email validation

```tsx
function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
```

This is a lightweight sanity check. It requires text before `@`, text between `@` and `.`, text after `.`, and no spaces or additional `@` characters.

It is intentionally not a complete implementation of the full email specification. Client validation is primarily for quick user feedback. The server independently validates the email because browser-side checks can be bypassed.

## 5. Extracting API errors

```tsx
function errorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback;
  const message = error.response?.data?.error;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}
```

Caught values are treated as `unknown`, so the function first checks whether the value is an Axios error. It then safely looks for a nonempty `response.data.error` string.

The logic is:

1. If the value is not an Axios error, use the fallback.
2. Read the API's `error` field with optional chaining.
3. Verify that it is a nonempty string.
4. Return the API message or the fallback.

This prevents the error handler from throwing another error while trying to display the original one.

## 6. The `BookPage` state model

`BookPage` contains the actual booking experience.

### Available slots

```tsx
const [slots, setSlots] = useState<Slot[]>([]);
```

This holds the currently available slots returned by the API. It starts empty because no request has completed yet.

### Initial loading status

```tsx
const [loading, setLoading] = useState(true);
```

This distinguishes "the request is still running" from "the request finished and returned no slots."

### Loading error

```tsx
const [loadError, setLoadError] = useState("");
```

An empty string means there is no loading error. A nonempty value is displayed in an error banner.

### Selected slot ID

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null);
```

- `null` means show the available-slot list.
- A slot ID means show the customer-details form.

This value effectively controls the current step of the page.

### Controlled form inputs

```tsx
const [guestName, setGuestName] = useState("");
const [guestEmail, setGuestEmail] = useState("");
```

React state is the source of truth for both inputs.

### Submission status

```tsx
const [submitting, setSubmitting] = useState(false);
```

This disables the submit button and changes its label while the booking request is running.

### Form error

```tsx
const [formError, setFormError] = useState("");
```

This stores validation errors and booking errors. It is separate from `loadError` because initial data loading and form submission are different operations.

### Booking confirmation

```tsx
const [confirmation, setConfirmation] =
  useState<BookingConfirmation | null>(null);
```

Before a successful booking it is `null`. After success it contains everything needed for the confirmation banner.

## 7. Loading slots

```tsx
async function loadSlots() {
  const { data } = await axios.get<Slot[]>("/api/slots");
  setSlots(data);
  return data;
}
```

This function:

1. Sends `GET /api/slots`.
2. extracts the response's `data` property.
3. saves it in React state.
4. returns it to the caller.

The Axios generic tells TypeScript to treat the response as `Slot[]`, but it does not perform runtime validation.

The function is reused on initial load, after a successful booking, and after stale-slot errors. Reusing it keeps all slot-fetching behavior in one place.

## 8. Initial page-load effect

```tsx
useEffect(() => {
  let cancelled = false;
```

The effect runs after the component first renders. The empty dependency array associates it with mounting the component:

```tsx
}, []);
```

It calls `loadSlots()`. If the request fails, it shows a loading error. Whether it succeeds or fails, it eventually sets `loading` to `false`.

```tsx
loadSlots()
  .catch(() => {
    if (!cancelled) setLoadError("Could not load available times.");
  })
  .finally(() => {
    if (!cancelled) setLoading(false);
  });
```

The cleanup function runs when the component unmounts:

```tsx
return () => {
  cancelled = true;
};
```

The flag prevents some state changes after unmounting. It does not actually cancel the HTTP request, and `loadSlots` can still call `setSlots`. An `AbortController` would provide more complete cancellation.

Because [`client/src/main.tsx`](../client/src/main.tsx) uses React `StrictMode`, development mode may invoke effects twice to reveal unsafe side effects. Developers may therefore see two slot requests locally even though production does not perform that development-only check.

## 9. Derived values

### Business name

```tsx
const businessName = slots[0]?.tenantName ?? "BookMe";
```

The name comes from the first available slot. Optional chaining protects against an empty array, and the nullish-coalescing operator falls back to `BookMe`.

One limitation is that a business with no available slots loses its name. A more complete API would return tenant information independently from availability.

### Selected slot

```tsx
const selected = slots.find((slot) => slot.id === selectedId) ?? null;
```

Only the selected ID is stored. The full slot is derived from the authoritative slot array. This avoids maintaining two pieces of state that could become inconsistent.

If the selected slot disappears during a refresh, `selected` automatically becomes `null`.

### Selected range

```tsx
const selectedRange = selected
  ? formatSlot(selected.startsAt, selected.endsAt)
  : null;
```

This is derived rather than stored. A useful React rule is: if a value can be calculated from existing state, avoid storing another independent copy of it.

## 10. Form submission

```tsx
async function onSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
```

Normal HTML form submission reloads or navigates the page. `preventDefault()` lets React handle the operation asynchronously.

### Guard clause

```tsx
if (!selected || submitting) return;
```

Submission is ignored if there is no valid selected slot or a request is already running. This helps prevent duplicate booking requests.

### Normalize and validate input

```tsx
const name = guestName.trim();
const email = guestEmail.trim();
```

Trimming prevents whitespace-only values from being accepted.

```tsx
if (!name || !email) {
  setFormError("Enter your name and email.");
  return;
}

if (!isEmail(email)) {
  setFormError("Enter a valid email address.");
  return;
}
```

These early returns stop invalid input before any network request begins.

### Enter submission mode

```tsx
setSubmitting(true);
setFormError("");
```

This disables the submit button, changes its label to `Booking…`, and clears an earlier error.

### Create the booking

```tsx
const { data } = await axios.post<{
  id: string;
  slotId: string;
  startsAt: string;
  endsAt: string;
}>("/api/bookings", {
  slotId: selected.id,
  guestName: name,
  guestEmail: email,
});
```

The request body contains the selected slot and normalized customer details. The inline type describes the expected successful response.

## 11. Successful submission

```tsx
setConfirmation({
  id: data.id,
  startsAt: data.startsAt,
  endsAt: data.endsAt,
  guestName: name,
  guestEmail: email,
});
```

The confirmation combines server-authoritative values with the locally normalized name and email.

The form workflow is then reset:

```tsx
setSelectedId(null);
setGuestName("");
setGuestEmail("");
```

Clearing `selectedId` switches the UI back to the slot list.

Finally:

```tsx
await loadSlots();
```

The app retrieves the authoritative list again, so the newly booked slot disappears. Refetching is slightly more expensive than manually removing it, but it reduces assumptions and keeps the UI synchronized with the server.

## 12. Error handling by HTTP status

```tsx
const status = axios.isAxiosError(error)
  ? error.response?.status
  : undefined;
```

Axios rejects unsuccessful HTTP responses. The code narrows the error and reads the response status.

### `409 Conflict`

A conflict means another customer booked the slot after this customer loaded the list.

```tsx
if (status === 409) {
  setFormError(errorMessage(error, "Slot already booked"));
  setSelectedId(null);
  await loadSlots();
}
```

The app explains the conflict, returns to the list, and refreshes availability. The database's unique `slotId` constraint provides the real double-booking protection; the frontend handles that conflict gracefully.

### `400 Bad Request`

```tsx
else if (status === 400) {
  setFormError(errorMessage(error, "Invalid booking details."));
}
```

The request failed server validation. The form stays open so the customer can correct it.

### `404 Not Found`

```tsx
else if (status === 404) {
  setFormError(errorMessage(error, "That time is no longer available."));
  setSelectedId(null);
  await loadSlots();
}
```

The slot no longer exists, so the app returns to a refreshed list.

### Unexpected failures

```tsx
else {
  setFormError("Could not complete the booking.");
}
```

This covers network failures, server errors, unexpected statuses, and non-Axios exceptions without leaking implementation details.

### Always leave submission mode

```tsx
finally {
  setSubmitting(false);
}
```

`finally` runs after success or failure, preventing the page from remaining permanently stuck in its submitting state.

## 13. Confirmation formatting

```tsx
const confirmedRange = confirmation
  ? formatSlot(confirmation.startsAt, confirmation.endsAt)
  : null;
```

Like `selectedRange`, this is derived from existing state instead of being stored independently.

## 14. Page shell and header

```tsx
<main className="page">
```

The page uses a semantic `<main>` element. Its class names are styled in [`client/src/index.css`](../client/src/index.css).

```tsx
<header className="masthead">
  <p className="eyebrow">Book a time</p>
  <h1>{businessName}</h1>
  <p className="lede">
    Choose an open time, then leave your name and email.
  </p>
</header>
```

The heading is always visible, and the business name is derived from the slot data.

## 15. Success and error banners

The success banner appears only when both the confirmation and its formatted range exist:

```tsx
{confirmation && confirmedRange ? (
  <section className="banner success" role="status">
```

`role="status"` helps assistive technology announce the successful update without treating it as an urgent error.

The initial loading error uses:

```tsx
role="alert"
```

That asks assistive technology to announce the error promptly.

## 16. The main conditional screen

The key rendering decision is:

```tsx
{selected ? (
  // Customer-details form
) : (
  // Available-slot list
)}
```

The app does not need a second URL for these steps. Selecting a slot changes React state, which changes the rendered screen.

| Condition | Interface shown |
|---|---|
| `selected === null` | Available-slot list |
| `selected !== null` | Customer-details form |
| `confirmation !== null` | Success banner above the main panel |
| `loading === true` | Loading message |
| `loadError !== ""` | Loading error |
| `submitting === true` | Disabled submit button |

## 17. Selected-slot form

The selected time is displayed from the derived range:

```tsx
<p className="selected-time">
  {selectedRange?.day}
  <span>{selectedRange?.time}</span>
</p>
```

The date and time use separate elements so CSS can display them on separate lines.

### Controlled name input

```tsx
<input
  name="guestName"
  autoComplete="name"
  value={guestName}
  onChange={(event) => setGuestName(event.target.value)}
/>
```

Every input change updates React state, causes a render, and sends the new value back to the input. `autoComplete="name"` helps browsers and password managers fill the field.

### Controlled email input

```tsx
<input
  name="guestEmail"
  type="email"
  autoComplete="email"
  value={guestEmail}
  onChange={(event) => setGuestEmail(event.target.value)}
/>
```

`type="email"` gives the browser semantic information and can provide an email-oriented keyboard on mobile devices.

### Submit button

```tsx
<button type="submit" disabled={submitting}>
  {submitting ? "Booking…" : "Confirm booking"}
</button>
```

While the request is running, the button is disabled and communicates progress.

### Back button

```tsx
<button
  type="button"
  className="secondary"
  onClick={() => {
    setSelectedId(null);
    setFormError("");
  }}
>
  Back
</button>
```

`type="button"` is important because a button inside a form otherwise defaults to submit behavior.

The Back action clears the selected slot and error, but preserves the entered name and email. That lets someone choose a different slot without retyping their details.

## 18. Slot-list states

The slot panel distinguishes several states.

### Loading

```tsx
{loading ? <p className="muted">Loading times…</p> : null}
```

### Successfully loaded but empty

```tsx
{!loading && !loadError && slots.length === 0 ? (
  <p className="muted">No open times right now.</p>
) : null}
```

All three conditions matter. Without `!loadError`, a failed request could incorrectly be presented as a successful empty result.

### Available slots

```tsx
<ul className="slots">
  {slots.map((slot) => {
```

Each slot becomes a list item. Its raw dates are formatted, and its stable ID is used as the React key:

```tsx
<li key={slot.id}>
```

The Book button selects that slot and clears an old form error:

```tsx
onClick={() => {
  setSelectedId(slot.id);
  setFormError("");
}}
```

That state update causes a render. The derived `selected` object becomes non-null, so the main conditional switches to the form.

## 19. Root `App` component and routing

```tsx
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BookPage />} />
    </Routes>
  );
}
```

`App` is the routing boundary, while `BookPage` contains the feature logic. Only `/` is currently defined.

The `BrowserRouter` is created in [`client/src/main.tsx`](../client/src/main.tsx):

```tsx
<BrowserRouter>
  <App />
</BrowserRouter>
```

The component hierarchy is:

```text
main.tsx
  └─ BrowserRouter
      └─ App
          └─ Routes
              └─ BookPage
```

## 20. How an engineer evaluates the implementation

### What it does well

- Separates initial-loading errors from form-submission errors.
- Models asynchronous progress with `loading` and `submitting`.
- Derives the selected object from the slot ID instead of duplicating state.
- Refreshes authoritative server data after a mutation.
- Handles a real booking race condition through HTTP `409`.
- Validates input on both the client and server.
- Uses semantic forms and accessibility roles.
- Keeps formatting and error helpers outside the component.
- Avoids unnecessary global state for a small feature.

### Partial request cancellation

The effect cleanup protects `setLoadError` and `setLoading`, but it does not stop the `setSlots` inside `loadSlots`. An `AbortController` would make cancellation more complete.

### No initial-load retry

There is no Retry button when the first slot request fails. Also, `loadSlots` does not clear `loadError` or set `loading` back to `true`, so it behaves more like a data-refresh helper than a complete loading-state controller.

### A refresh failure can misreport a successful booking

After the booking succeeds, the code awaits `loadSlots()` inside the same `try` block. If the booking succeeds but the refresh fails, execution enters the booking `catch` and may display `Could not complete the booking` even though the booking was created.

An engineer would normally separate these operations:

```text
Create booking
    ↓
Report booking outcome
    ↓
Refresh slot list independently
```

The same concern exists when `loadSlots()` is awaited from inside the `404` and `409` error branches.

### Business identity depends on available slots

The business name is extracted from `slots[0]`. If no slots are available, the UI falls back to `BookMe`. Tenant information should eventually be fetched independently from availability.

### Time zone is implicit

The visitor's browser controls the displayed time zone. A production booking system should explicitly decide whether to display the tenant's time zone, the visitor's time zone, or both.

### API types are compile-time only

Axios generic types describe the expected JSON but do not validate it. A production client could validate responses with Zod or another runtime schema.

### Future component extraction

The component is currently manageable. As the feature grows, sensible extractions could include:

- `SlotList`
- `BookingForm`
- `ConfirmationBanner`
- a `useSlots` hook
- API functions such as `getSlots` and `createBooking`
- shared request and response types

Extraction is useful when responsibilities become difficult to reason about or test; splitting a small component merely for file count is not automatically an improvement.

## 21. The central mental model

The page is a small state machine:

```text
LOADING_SLOTS
    ↓
SHOWING_SLOTS
    ↓ select slot
ENTERING_DETAILS
    ↓ submit
SUBMITTING
    ├─ success → SHOWING_SLOTS + CONFIRMATION
    ├─ validation error → ENTERING_DETAILS + ERROR
    └─ stale slot → SHOWING_SLOTS + ERROR
```

React does not declare this as a formal state machine. It emerges from the combination of:

```tsx
loading
slots
selectedId
submitting
formError
confirmation
```

Every state update causes `BookPage` to execute again. React evaluates the conditions and produces the interface corresponding to the new state. The core idea behind the file is therefore:

> Application state determines the rendered user interface.
