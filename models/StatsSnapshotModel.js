import mongoose from "mongoose";

// Periodic point-in-time sample of platform activity, used to draw
// "online users over time" style graphs. TTL-indexed so the collection
// self-prunes instead of growing forever.
const statsSnapshotSchema = new mongoose.Schema({
  onlineCount:  { type: Number, required: true },
  liveMatches:  { type: Number, required: true },
  totalUsers:   { type: Number, required: true },
  totalMatches: { type: Number, required: true },
  // `expires` already creates a TTL index on this field — no separate .index() needed.
  timestamp:    { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }, // 30 days
});

export const StatsSnapshotModel = mongoose.model("StatsSnapshotModel", statsSnapshotSchema);
