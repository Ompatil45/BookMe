import { useEffect, useState, type FormEvent } from "react";
import { Route, Routes } from "react-router-dom";
import axios from "axios";

type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
  tenantName: string;
};

type BookingConfirmation = {
  id: string;
  startsAt: string;
  endsAt: string;
  guestName: string;
  guestEmail: string;
};

function formatSlot(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = `${start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} – ${end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
  return { day, time };
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback;
  const message = error.response?.data?.error;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

function BookPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null,
  );

  async function loadSlots() {
    const { data } = await axios.get<Slot[]>("/api/slots");
    setSlots(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    loadSlots()
      .catch(() => {
        if (!cancelled) setLoadError("Could not load available times.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const businessName = slots[0]?.tenantName ?? "BookMe";
  const selected = slots.find((slot) => slot.id === selectedId) ?? null;
  const selectedRange = selected
    ? formatSlot(selected.startsAt, selected.endsAt)
    : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || submitting) return;

    const name = guestName.trim();
    const email = guestEmail.trim();
    if (!name || !email) {
      setFormError("Enter your name and email.");
      return;
    }
    if (!isEmail(email)) {
      setFormError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
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
      setConfirmation({
        id: data.id,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        guestName: name,
        guestEmail: email,
      });
      setSelectedId(null);
      setGuestName("");
      setGuestEmail("");
      await loadSlots();
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 409) {
        setFormError(errorMessage(error, "Slot already booked"));
        setSelectedId(null);
        await loadSlots();
      } else if (status === 400) {
        setFormError(errorMessage(error, "Invalid booking details."));
      } else if (status === 404) {
        setFormError(errorMessage(error, "That time is no longer available."));
        setSelectedId(null);
        await loadSlots();
      } else {
        setFormError("Could not complete the booking.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const confirmedRange = confirmation
    ? formatSlot(confirmation.startsAt, confirmation.endsAt)
    : null;

  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">Book a time</p>
        <h1>{businessName}</h1>
        <p className="lede">Choose an open time, then leave your name and email.</p>
      </header>

      {confirmation && confirmedRange ? (
        <section className="banner success" role="status">
          <h2>You’re booked</h2>
          <p>
            {confirmation.guestName}, {confirmedRange.day} at {confirmedRange.time}.
            A confirmation is saved for {confirmation.guestEmail}.
          </p>
        </section>
      ) : null}

      {loadError ? (
        <p className="banner error" role="alert">
          {loadError}
        </p>
      ) : null}

      {selected ? (
        <section className="panel">
          <h2>Your details</h2>
          <p className="selected-time">
            {selectedRange?.day}
            <span>{selectedRange?.time}</span>
          </p>
          {formError ? (
            <p className="banner error" role="alert">
              {formError}
            </p>
          ) : null}
          <form onSubmit={onSubmit}>
            <label>
              Name
              <input
                name="guestName"
                autoComplete="name"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
              />
            </label>
            <label>
              Email
              <input
                name="guestEmail"
                type="email"
                autoComplete="email"
                value={guestEmail}
                onChange={(event) => setGuestEmail(event.target.value)}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={submitting}>
                {submitting ? "Booking…" : "Confirm booking"}
              </button>
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
            </div>
          </form>
        </section>
      ) : (
        <section className="panel">
          <h2>Open times</h2>
          {formError ? (
            <p className="banner error" role="alert">
              {formError}
            </p>
          ) : null}
          {loading ? <p className="muted">Loading times…</p> : null}
          {!loading && !loadError && slots.length === 0 ? (
            <p className="muted">No open times right now.</p>
          ) : null}
          <ul className="slots">
            {slots.map((slot) => {
              const range = formatSlot(slot.startsAt, slot.endsAt);
              return (
                <li key={slot.id}>
                  <div>
                    <strong>{range.day}</strong>
                    <span>{range.time}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(slot.id);
                      setFormError("");
                    }}
                  >
                    Book
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BookPage />} />
    </Routes>
  );
}
