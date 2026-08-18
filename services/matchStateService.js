import matchmakingRedis from "../config/matchmakingRedis.js";

const MATCH_DURATION_SECONDS = {
  Easy:   2 * 60 + 10,    // 130 — TEMP: shortened for faster testing of the match-end pipeline, revert to 925 after
  Medium: 25 * 60 + 15,   // 1515
  Hard:   40 * 60 + 25,   // 2425
};

// Match-end processing (client timer hitting 0 → match_ended socket event →
// server merge/lock/judge/emit) needs the Redis match key to still exist well
// past the match's natural endsAt. A tight buffer here is a real race: a
// mid-match submission's TTL refresh should never expire close to endsAt.
export const MATCH_END_GRACE_SECONDS = 600; // 10 minutes past endsAt

export const createMatchState = async ({ matchId, playerA, playerB, problem }) => {
  const duration = MATCH_DURATION_SECONDS[problem?.difficulty] || 925;
  const endsAt = Date.now() + duration * 1000;

  const matchState = {
    matchId,
    playerA: {
      userId:          playerA,
      testsPassed:     0,
      totalTests:      0,
      submitted:       false,
      submissionCount: 0,
      aiUsageCount:    0,
      timeTaken:       null,
    
    },
    playerB: {
      userId:          playerB,
      testsPassed:     0,
      totalTests:      0,
      submitted:       false,
      submissionCount: 0,
      aiUsageCount:    0,
      timeTaken:       null,
    },
    problem: {
      id:         problem?.id || null,
      title:      problem?.title || "",
      difficulty: problem?.difficulty || "Easy",
    },
    status:    "ongoing",
    winner:    null,
    startedAt: Date.now(),
    endsAt,
  };

  await matchmakingRedis.set(`match:${matchId}`, JSON.stringify(matchState),"EX",duration + MATCH_END_GRACE_SECONDS);
  await matchmakingRedis.zadd('active_matches', endsAt, matchId);

  /* userId → matchId index for cheap "are you mid-match?" lookup */
  const ttl = duration + MATCH_END_GRACE_SECONDS;
  if (playerA)
    await matchmakingRedis.set(`user:${playerA}:match`,  matchId, "EX", ttl);
  if (playerB)
    await matchmakingRedis.set(`user:${playerB}:match`,  matchId, "EX", ttl);

  return matchState;
};

export const getMatchState = async (matchId) => {
  const data = await matchmakingRedis.get(`match:${matchId}`);
  if (!data) return null;
  return JSON.parse(data);
};

export const getMatchWithTimer = async (matchId) => {
  const data = await matchmakingRedis.get(`match:${matchId}`);
  if (!data) return null;

  const matchState = JSON.parse(data);
  const elapsed    = (Date.now() - matchState.startedAt) / 1000;
  const total = MATCH_DURATION_SECONDS[matchState.problem?.difficulty] || 925;
  const timeLeft   = Math.max(0, Math.floor(total - elapsed));

  return { ...matchState, timeLeft };
};

// Redis GET-then-SET is not atomic: when both players submit around the same
// time, the second write can be based on a stale read and clobber the first
// player's fresh testsPassed. matchmakingRedis is a single shared connection
// used everywhere, so WATCH/MULTI (which is per-connection, not per-caller)
// can't isolate concurrent callers — use a short-lived spinlock instead, same
// pattern as the match-end lock in matchEndHandler.js.
const withMatchLock = async (matchId, mutate) => {
  const key      = `match:${matchId}`;
  const lockKey  = `match:lock:${matchId}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    const acquired = await matchmakingRedis.set(lockKey, "1", "NX", "PX", 2000);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, 25));
      continue;
    }

    try {
      const data = await matchmakingRedis.get(key);
      if (!data) throw new Error(`Match not found: ${matchId}`);

      const matchState = JSON.parse(data);
      mutate(matchState);

      // Grace period is added on top of "time until endsAt", not used as a
      // bare floor — otherwise a submission made early in the match still
      // sets a TTL that expires right at endsAt, the exact race this guards
      // against.
      const remainingSeconds = Math.max(
        60,
        Math.floor((matchState.endsAt - Date.now()) / 1000) + MATCH_END_GRACE_SECONDS
      );
      await matchmakingRedis.set(key, JSON.stringify(matchState), "EX", remainingSeconds);
      return matchState;
    } finally {
      await matchmakingRedis.del(lockKey);
    }
  }
  throw new Error(`withMatchLock: could not acquire lock for match ${matchId}`);
};

export const updatePlayerSubmission = async ({ matchId, userId, testsPassed, totalTests }) => {
  return withMatchLock(matchId, (matchState) => {
    const now = Date.now();

    if (matchState.playerA.userId === userId) {
      matchState.playerA.testsPassed     = testsPassed;
      matchState.playerA.totalTests      = totalTests;
      matchState.playerA.submitted       = true;
      matchState.playerA.submissionCount = (matchState.playerA.submissionCount || 0) + 1;
      if (testsPassed === totalTests && totalTests > 0 && !matchState.playerA.timeTaken) {
        matchState.playerA.timeTaken = Math.floor((now - matchState.startedAt) / 1000);
      }
    } else if (matchState.playerB.userId === userId) {
      matchState.playerB.testsPassed     = testsPassed;
      matchState.playerB.totalTests      = totalTests;
      matchState.playerB.submitted       = true;
      matchState.playerB.submissionCount = (matchState.playerB.submissionCount || 0) + 1;
      if (testsPassed === totalTests && totalTests > 0 && !matchState.playerB.timeTaken) {
        matchState.playerB.timeTaken = Math.floor((now - matchState.startedAt) / 1000);
      }
    }
  });
};

// Merges a player's final code/language/stats into the snapshot. Called by
// both players' match_ended events — must not depend on who wins the
// match-end "compute once" lock, or the loser's data is silently dropped.
export const mergePlayerData = async ({ matchId, userId, code, language, testsPassed, submissionCount, aiUsageCount }) => {
  return withMatchLock(matchId, (matchState) => {
    const player = matchState.playerA.userId === userId ? matchState.playerA : matchState.playerB
    if (code !== undefined)        player.code = code
    if (language !== undefined)    player.language = language
    if (testsPassed != null)       player.testsPassed = testsPassed
    if (submissionCount != null)   player.submissionCount = submissionCount
    if (aiUsageCount != null)      player.aiUsageCount = aiUsageCount
  });
};

export const incrementAIUsage = async ({ matchId, userId }) => {
  return withMatchLock(matchId, (matchState) => {
    if (matchState.playerA.userId === userId) {
      matchState.playerA.aiUsageCount = (matchState.playerA.aiUsageCount || 0) + 1;
    } else if (matchState.playerB.userId === userId) {
      matchState.playerB.aiUsageCount = (matchState.playerB.aiUsageCount || 0) + 1;
    }
  });
};

export const finishMatch = async ({ matchId, winner }) => {
  const data = await matchmakingRedis.get(`match:${matchId}`);
  if (!data) throw new Error(`Match not found: ${matchId}`);

  const matchState    = JSON.parse(data);
  matchState.status   = "finished";
  matchState.winner   = winner;
  matchState.finishedAt = Date.now();

  await matchmakingRedis.set(`match:${matchId}`, JSON.stringify(matchState), "EX", 3600);
  await matchmakingRedis.zrem('active_matches', matchId);

  /* Clear the per-user active-match index */
  const aId = matchState?.playerA?.userId;
  const bId = matchState?.playerB?.userId;
  if (aId) await matchmakingRedis.del(`user:${aId}:match`);
  if (bId) await matchmakingRedis.del(`user:${bId}:match`);

  return matchState;
};

/* ── Look up a user's current ongoing match (if any) ─────── */
export const getActiveMatchForUser = async (userId) => {
  if (!userId) {
    console.log("[active-match] no userId provided")
    return null
  }
  const key     = `user:${userId}:match`
  const matchId = await matchmakingRedis.get(key)
  console.log(`[active-match] lookup ${key} →`, matchId || "(empty)")

  if (!matchId) return null

  const match = await getMatchWithTimer(matchId)
  if (!match) {
    console.log(`[active-match] match:${matchId} not found in redis (TTL likely expired)`)
    /* Stale pointer — clean it up so we don't keep redirecting nowhere */
    await matchmakingRedis.del(key)
    return null
  }
  if (match.status !== "ongoing") {
    console.log(`[active-match] match:${matchId} status=${match.status}, not redirecting`)
    /* Already finished — clean up the pointer */
    await matchmakingRedis.del(key)
    return null
  }
  console.log(`[active-match] ✓ user ${userId} is in match ${matchId}, timeLeft=${match.timeLeft}s`)
  return match
}