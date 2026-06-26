import {
  updatePlayerRating,
  getTopPlayers,
  getPlayerRank,
  getTotalRanked,
  getLeaderboardWithMe,
} from "../services/leaderboardService.js";

/* POST /api/leaderboard/update  — manual rating sync (internal) */
export const updateLeaderboard = async (req, res, next) => {
  try {
    const { userId, rating } = req.body;
    await updatePlayerRating({ userId, rating });
    res.json({ success: true, message: "Leaderboard updated" });
  } catch (err) {
    next(err);
  }
};

/* GET /api/leaderboard  — top 9 (public) */
export const leaderboard = async (req, res, next) => {
  try {
    const players = await getTopPlayers(9);
    const total   = await getTotalRanked();
    res.json({ success: true, players, total });
  } catch (err) {
    next(err);
  }
};

/* GET /api/leaderboard/me  — top 9 + current user's rank (auth) */
export const leaderboardWithMe = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const data   = await getLeaderboardWithMe(userId);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

/* GET /api/leaderboard/rank/:userId — public rank lookup */
export const playerRank = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const rank = await getPlayerRank(userId);
    res.json({ success: true, rank: rank == null ? null : rank + 1 });
  } catch (err) {
    next(err);
  }
};
