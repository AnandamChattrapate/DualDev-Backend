import leaderboardRedis from "../config/leaderboardRedis.js";
import UserModel from "../models/UserModel.js";

const KEY = "leaderboard";

/* ── Write: always sync (ZADD replaces score) ─────────────── */
export const updatePlayerRating = async ({ userId, rating }) => {
  if (!userId || rating == null) return false;
  await leaderboardRedis.zadd(KEY, rating, userId.toString());
  return true;
};

/* ── Read: top N with enriched user info ──────────────────── */
export const getTopPlayers = async (count = 9) => {
  /* zrevrange returns [userId, score, userId, score, ...] */
  const raw = await leaderboardRedis.zrevrange(KEY, 0, count - 1, "WITHSCORES");

  if (!raw || raw.length === 0) return [];

  const entries = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ userId: raw[i], rating: Number(raw[i + 1]) });
  }

  /* Hydrate with usernames from Mongo (single batched query) */
  const userIds = entries.map((e) => e.userId);
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("_id username avatar wins losses")
    .lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return entries.map((e, idx) => {
    const u = userMap.get(e.userId);
    return {
      rank:     idx + 1,
      userId:   e.userId,
      rating:   e.rating,
      username: u?.username || "Unknown",
      avatar:   u?.avatar   || "",
      wins:     u?.wins     || 0,
      losses:   u?.losses   || 0,
    };
  });
};

/* ── Read: rank for a single user (0-based from Redis) ───── */
export const getPlayerRank = async (userId) => {
  if (!userId) return null;
  const rank = await leaderboardRedis.zrevrank(KEY, userId.toString());
  return rank == null ? null : rank;
};

/* ── Read: total players ranked ───────────────────────────── */
export const getTotalRanked = async () => {
  return await leaderboardRedis.zcard(KEY);
};

/* ── Read: full "leaderboard + me" payload ────────────────── */
export const getLeaderboardWithMe = async (userId) => {
  const top   = await getTopPlayers(9);
  const total = await getTotalRanked();

  let me = null;
  if (userId) {
    const idStr = userId.toString();
    const rank  = await getPlayerRank(idStr);
    const score = await leaderboardRedis.zscore(KEY, idStr);

    /* Pull user info from Mongo so the "me" row matches the top format */
    const u = await UserModel.findById(idStr)
      .select("_id username avatar wins losses rating")
      .lean();

    if (u) {
      me = {
        userId:   idStr,
        username: u.username,
        avatar:   u.avatar || "",
        wins:     u.wins   || 0,
        losses:   u.losses || 0,
        /* rating: prefer Redis (live) over Mongo */
        rating:   score != null ? Number(score) : (u.rating || 0),
        /* rank: null if unranked yet */
        rank:     rank == null ? null : rank + 1,
      };
    }
  }

  return { top, total, me };
};
