/**
 * Timezone helpers for scheduling.
 *
 * The planner picks wall-clock hours that suit a local business — 09:00,
 * 12:30, 17:00. Those are meaningless without a zone: treating "09:00" as UTC
 * publishes at 2am in California, which is useless to the customer and the
 * opposite of what the distribution playbook is trying to achieve.
 *
 * Uses Intl rather than a date library, so DST is resolved by the platform's
 * own tz database for the specific date in question.
 */

/**
 * Is this a real IANA timezone the platform can resolve? Used to reject a junk
 * value ("PST", "California", "") at the write boundary, so the scheduling and
 * quiet-hours helpers never silently fall back to UTC and text someone at 3am.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds to add to a UTC-parsed wall time to get the true instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  try {
    const asUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
    const asZone = new Date(instant.toLocaleString('en-US', { timeZone }));
    return asUtc.getTime() - asZone.getTime();
  } catch {
    return 0; // unknown zone → treat as UTC rather than throwing
  }
}

/**
 * "2026-07-20" + "09:00" in America/Los_Angeles → the real UTC instant of
 * 9am Pacific that day.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) {
    // Returning "now" here silently turned a malformed slot into an immediate
    // publish — a post meant for a future wall-clock slot went out on the next
    // sweep. A bad scheduling instant is data corruption, so refuse it loudly
    // and let the caller (which already tolerates a failed slot) skip it.
    throw new Error(`zonedToUtc: invalid date/time "${date}T${time}"`);
  }
  return new Date(naive.getTime() + zoneOffsetMs(naive, timeZone));
}

/** "Tue, 9:00 AM" in the business's own zone — how the owner thinks about it. */
export function formatInZone(when: Date, timeZone: string, now: Date = new Date()): string {
  // A weekday alone is only clear within the coming week: QA round 4 showed
  // "Draft for Tue 10:00 AM" (tomorrow) right after "Draft for Tue 12:30 PM"
  // (a week out). Near days get "today"/"tomorrow", far ones get the date.
  try {
    const time = when.toLocaleString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    const days = Math.round((localMidnight(when, timeZone) - localMidnight(now, timeZone)) / 86_400_000);
    if (days === 0) return `today ${time}`;
    if (days === 1) return `tomorrow ${time}`;
    if (days > 1 && days < 7) return `${when.toLocaleString('en-US', { timeZone, weekday: 'short' })} ${time}`;
    return formatFull(when, timeZone);
  } catch {
    return when.toISOString();
  }
}

/** Weekday, date and time, e.g. "Tue, Nov 24, 12:30 PM", for prompts and far dates. */
export function formatFull(when: Date, timeZone: string): string {
  try {
    return when.toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return when.toISOString();
  }
}

/** The local calendar day of an instant, as a UTC timestamp of its midnight. */
function localMidnight(when: Date, timeZone: string): number {
  const [y, m, d] = when.toLocaleDateString('en-CA', { timeZone }).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * TCPA texting window: 8:00–21:00 in the recipient's own zone. Unprompted
 * texts outside it are queued, not sent (quiet-hours rule; replies to an
 * active conversation are exempt and never come through here).
 */
export const TEXTING_WINDOW = { open: 8, close: 21 } as const;

/** The hour (0–23) on the recipient's wall clock at a given instant. */
export function hourInZone(when: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(when);
    return Number(hour);
  } catch {
    return when.getUTCHours(); // unknown zone → UTC, consistent with zoneOffsetMs
  }
}

/** Is it currently OK to send an unprompted text to this zone? */
export function inTextingWindow(when: Date, timeZone: string): boolean {
  const h = hourInZone(when, timeZone);
  return h >= TEXTING_WINDOW.open && h < TEXTING_WINDOW.close;
}

/**
 * The next instant the texting window opens in the recipient's zone: today's
 * 8:00 if it's still ahead of them, otherwise tomorrow's. DST is handled by
 * zonedToUtc for the specific date.
 */
export function nextTextingWindowOpen(now: Date, timeZone: string): Date {
  const localDate = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const openTime = `${String(TEXTING_WINDOW.open).padStart(2, '0')}:00`;
  const todayOpen = zonedToUtc(localDate(now), openTime, timeZone);
  if (todayOpen > now) return todayOpen;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return zonedToUtc(localDate(tomorrow), openTime, timeZone);
}

/** Tomorrow at 9am in the business's zone, as a UTC instant. */
export function tomorrowMorningInZone(timeZone: string): Date {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(tomorrow);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
  return zonedToUtc(`${get('year')}-${get('month')}-${get('day')}`, '09:00', timeZone);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Reads plain timing from a text without a model: "now", "tomorrow at 2pm",
 * "Thursday 9:30am", "friday". It's the fallback for when the model is
 * unreachable, so a reschedule still works instead of "tell me when". A day
 * with no time keeps the post's planned time of day (10:00 if none). Returns
 * null when it can't be sure.
 */
export function parseTimeLocally(
  text: string,
  timeZone: string,
  now: Date = new Date(),
  plannedTime?: Date | null,
): Date | null {
  const t = text.toLowerCase();
  if (/\b(right now|now|asap|immediately)\b/.test(t)) return now;

  const localDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone });
  const today = localDate(now);
  const dayOffset = (n: number) => localDate(new Date(now.getTime() + n * 24 * 3600_000));
  let date: string | null = null;
  if (/\btoday\b|\btonight\b/.test(t)) date = today;
  else if (/\btomorrow\b/.test(t)) date = dayOffset(1);
  else {
    const m = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(t);
    if (m) {
      const todayIdx = new Date(`${today}T12:00:00Z`).getUTCDay();
      let add = (WEEKDAYS.indexOf(m[1]) - todayIdx + 7) % 7;
      if (add === 0) add = 7; // "Thursday" said on a Thursday means next week's
      date = dayOffset(add);
    }
  }

  let time: string | null = null;
  const tm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b|\bnoon\b/.exec(t);
  if (tm) {
    if (tm[0] === 'noon') time = '12:00';
    else if (tm[3]) {
      let h = Number(tm[1]) % 12;
      if (tm[3] === 'pm') h += 12;
      time = `${String(h).padStart(2, '0')}:${tm[2] ?? '00'}`;
    } else if (Number(tm[4]) < 24) time = `${tm[4].padStart(2, '0')}:${tm[5]}`;
  } else if (/\btonight\b/.test(t)) time = '19:00';

  if (!date && !time) return null;
  if (!time) {
    time = plannedTime
      ? plannedTime.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
      : '10:00';
  }
  let when = zonedToUtc(date ?? today, time, timeZone);
  // "2pm" alone, already past today, means tomorrow at 2.
  if (!date && when.getTime() <= now.getTime()) when = zonedToUtc(dayOffset(1), time, timeZone);
  return when;
}
