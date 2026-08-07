import matchmakingRedis from "../config/matchmakingRedis.js";
import UserModel from "../models/UserModel.js";
import { MatchModel } from "../models/MatchModel.js";
import { StatsSnapshotModel } from "../models/StatsSnapshotModel.js";

const HEARTBEAT_KEY = "online_heartbeats";
const HEARTBEAT_TIMEOUT = 10_000;

const readLiveCounts = async () => {
  const now = Date.now();
  const [onlineCount, liveMatches, totalUsers, totalMatches] = await Promise.all([
    matchmakingRedis.zcount(HEARTBEAT_KEY, now - HEARTBEAT_TIMEOUT, "+inf"),
    matchmakingRedis.zcount("active_matches", now, "+inf"),
    UserModel.countDocuments(),
    MatchModel.countDocuments(),
  ]);
  return {
    onlineCount: Number(onlineCount),
    liveMatches: Number(liveMatches),
    totalUsers,
    totalMatches,
  };
};

// Sampled on a timer (server.js) so the online-users graph has history to draw.
export const recordSnapshot = async () => {
  const counts = await readLiveCounts();
  await StatsSnapshotModel.create(counts);
  return counts;
};

export const getSummary = async () => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [live, matchesToday, draws, decisive] = await Promise.all([
    readLiveCounts(),
    MatchModel.countDocuments({ status: "finished", finishedAt: { $gte: startOfDay } }),
    MatchModel.countDocuments({ status: "finished", winner: "draw" }),
    MatchModel.countDocuments({ status: "finished", winner: { $ne: "draw" } }),
  ]);

  return {
    totalUsers:      live.totalUsers,
    totalMatches:    live.totalMatches,
    matchesToday,
    playersOnline:   live.onlineCount,
    liveMatchesNow:  live.liveMatches,
    resultBreakdown: { decisive, draws },
  };
};

export const getOnlineTimeseries = async (hours = 24) => {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await StatsSnapshotModel.find({ timestamp: { $gte: cutoff } })
    .sort({ timestamp: 1 })
    .select("timestamp onlineCount")
    .lean();
  return rows.map((r) => ({ t: r.timestamp, onlineCount: r.onlineCount }));
};

const dayBucketAggregate = (Model, dateField, matchStage, cutoff) =>
  Model.aggregate([
    { $match: { ...matchStage, [dateField]: { $gte: cutoff } } },
    {
      $group: {
        _id:   { $dateToString: { format: "%Y-%m-%d", date: `$${dateField}` } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

export const getSignupsTimeseries = async (days = 30) => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await dayBucketAggregate(UserModel, "createdAt", {}, cutoff);
  return rows.map((r) => ({ date: r._id, count: r.count }));
};

export const getMatchesTimeseries = async (days = 30) => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await dayBucketAggregate(MatchModel, "finishedAt", { status: "finished" }, cutoff);
  return rows.map((r) => ({ date: r._id, count: r.count }));
};

export const getRecentMatches = async (limit = 20) => {
  const capped = Math.min(limit, 50);
  const matches = await MatchModel.find({ status: "finished" })
    .sort({ finishedAt: -1 })
    .limit(capped)
    .populate("players.user", "username rating")
    .populate("problem", "title difficulty")
    .lean();

  return matches.map((m) => {
    const [a, b] = m.players || [];
    return {
      matchId:    m.matchId,
      playerA:    a?.user ? { username: a.user.username, rating: a.user.rating, result: a.result } : null,
      playerB:    b?.user ? { username: b.user.username, rating: b.user.rating, result: b.result } : null,
      problem:    m.problem ? { title: m.problem.title, difficulty: m.problem.difficulty } : null,
      winner:     m.winner,
      finishedAt: m.finishedAt,
    };
  });
};
