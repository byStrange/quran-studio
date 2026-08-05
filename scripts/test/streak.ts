/**
 * Streak-rule verification against the real database.
 *
 *   pnpm test:streak
 *
 * Creates a throwaway auth user, replays synthetic daily reading histories
 * through `daily_reading`, and asserts what the trigger computes into
 * `streak_state`. The user is deleted at the end.
 *
 * These rules are easy to get subtly wrong and impossible to eyeball, so they
 * get a real test rather than a manual click-through.
 */
import { admin } from "../seed/db.ts";

const HOUR = 3600;
const HALF_HOUR = 1800;

interface Scenario {
  name: string;
  /** Day offsets from today (0 = today, -1 = yesterday) → seconds read. */
  history: Record<number, number>;
  expect: {
    current_streak: number;
    longest_streak: number;
    in_grace: boolean;
    grace_expires_offset?: number;
  };
  why: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "consecutive days build a streak",
    history: { [-4]: HALF_HOUR, [-3]: HALF_HOUR, [-2]: HALF_HOUR, [-1]: HALF_HOUR, 0: HALF_HOUR },
    expect: { current_streak: 5, longest_streak: 5, in_grace: false },
    why: "Any reading time counts a day.",
  },
  {
    name: "today with no reading yet does not break the streak",
    history: { [-3]: HALF_HOUR, [-2]: HALF_HOUR, [-1]: HALF_HOUR },
    expect: { current_streak: 3, longest_streak: 3, in_grace: false },
    why: "Today is not over, so it is never treated as a miss.",
  },
  {
    name: "a missed day opens the grace window instead of resetting",
    history: { [-5]: HALF_HOUR, [-4]: HALF_HOUR, [-3]: HALF_HOUR, [-1]: HALF_HOUR },
    expect: {
      current_streak: 3,
      longest_streak: 3,
      in_grace: true,
      grace_expires_offset: 1,
    },
    why: "The miss on -2 starts a 3-day window; a half-hour day does not restore.",
  },
  {
    name: "a full hour inside the window restores the streak",
    // -3 is genuinely missed; -2 is a short day that cannot restore; -1 is the
    // qualifying hour. A day with *any* reading counts normally, so the miss
    // has to be a real gap for the grace rules to engage at all.
    history: { [-6]: HALF_HOUR, [-5]: HALF_HOUR, [-4]: HALF_HOUR, [-2]: 600, [-1]: HOUR },
    expect: { current_streak: 4, longest_streak: 4, in_grace: false },
    why: "1h on -1 restores and continues the count rather than resetting to 1.",
  },
  {
    name: "the window lapsing resets the streak to zero",
    history: { [-8]: HALF_HOUR, [-7]: HALF_HOUR, [-2]: HALF_HOUR },
    expect: {
      current_streak: 1,
      longest_streak: 2,
      in_grace: true,
      grace_expires_offset: 2,
    },
    why: "Grace from -6 expired on -3, so -2 starts a fresh streak at 1.",
  },
  {
    name: "under an hour during grace keeps the window running",
    history: { [-4]: HALF_HOUR, [-3]: HALF_HOUR, [-1]: 900, 0: 900 },
    expect: {
      current_streak: 2,
      longest_streak: 2,
      in_grace: true,
      grace_expires_offset: 1,
    },
    why: "Short days inside the window neither restore nor reset.",
  },
  {
    name: "no reading at all leaves everything at zero",
    history: {},
    expect: { current_streak: 0, longest_streak: 0, in_grace: false },
    why: "Nothing to compute from.",
  },
];

function offsetToDate(offset: number): string {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight + offset * 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const email = `streak-test-${Date.now()}@quran-studio.test`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: `test-${Math.random().toString(36).slice(2)}`,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`could not create test user: ${createError?.message}`);
  }
  const userId = created.user.id;
  console.log(`test user ${email}\n`);

  // Streak days are evaluated in the profile's timezone; pin it for determinism.
  const { error: tzError } = await admin
    .from("profiles")
    .update({ timezone: "UTC" })
    .eq("user_id", userId);
  if (tzError) throw new Error(`could not set timezone: ${tzError.message}`);

  let passed = 0;
  const failures: string[] = [];

  try {
    for (const scenario of SCENARIOS) {
      // Clearing history fires the trigger and zeroes the current streak.
      await admin.from("daily_reading").delete().eq("user_id", userId);
      // `longest_streak` deliberately never shrinks in production, so it has
      // to be reset between scenarios or earlier runs leak into later ones.
      await admin
        .from("streak_state")
        .update({ longest_streak: 0 })
        .eq("user_id", userId);

      const rows = Object.entries(scenario.history).map(([offset, seconds]) => ({
        user_id: userId,
        day: offsetToDate(Number(offset)),
        seconds_read: seconds,
      }));
      if (rows.length > 0) {
        const { error } = await admin.from("daily_reading").insert(rows);
        if (error) throw new Error(`insert failed: ${error.message}`);
      }

      const { data: state, error } = await admin
        .from("streak_state")
        .select("*")
        .eq("user_id", userId)
        .single();
      if (error) throw new Error(`reading streak_state failed: ${error.message}`);

      const problems: string[] = [];
      if (state.current_streak !== scenario.expect.current_streak) {
        problems.push(
          `current_streak ${state.current_streak}, expected ${scenario.expect.current_streak}`,
        );
      }
      if (state.longest_streak !== scenario.expect.longest_streak) {
        problems.push(
          `longest_streak ${state.longest_streak}, expected ${scenario.expect.longest_streak}`,
        );
      }
      const inGrace = state.grace_expires_on !== null;
      if (inGrace !== scenario.expect.in_grace) {
        problems.push(`in_grace ${inGrace}, expected ${scenario.expect.in_grace}`);
      }
      if (scenario.expect.grace_expires_offset !== undefined) {
        const expected = offsetToDate(scenario.expect.grace_expires_offset);
        if (state.grace_expires_on !== expected) {
          problems.push(`grace_expires_on ${state.grace_expires_on}, expected ${expected}`);
        }
      }

      if (problems.length === 0) {
        console.log(`  ✓ ${scenario.name}`);
        passed++;
      } else {
        console.log(`  ✗ ${scenario.name}`);
        console.log(`      ${scenario.why}`);
        for (const problem of problems) console.log(`      ${problem}`);
        failures.push(scenario.name);
      }
    }
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }

  console.log(`\n${passed}/${SCENARIOS.length} scenarios passed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nStreak test failed:\n", error);
  process.exit(1);
});
