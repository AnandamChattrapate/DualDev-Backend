import redis from '../config/matchmakingRedis.js' 

const STATS_KEY = 'codejudge:stats';

// Initialize defaults on startup (call this once in server.js)
export const initializeStats = async () => {
  await redis.hsetnx(STATS_KEY, 'playersOnline', 0);
  await redis.hsetnx(STATS_KEY, 'battlesPlayed', 1200000); // your starting value
  await redis.hsetnx(STATS_KEY, 'battlesLiveNow', 0);
};

// GET /api/stats
const HEARTBEAT_KEY = 'online_heartbeats'
const HEARTBEAT_TIMEOUT = 10_000

export const getStats = async (req, res) => {
  try {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT;
    const now = Date.now();

    const [playersOnline, battlesPlayed, battlesLiveNow] = await Promise.all([
      redis.zcount(HEARTBEAT_KEY, cutoff, '+inf'),
      redis.hget('codejudge:stats', 'battlesPlayed'),
      redis.zcount('active_matches', now, '+inf'),   // ← live matches
    ]);

    res.json({
      playersOnline: Number(playersOnline),
      battlesPlayed: Number(battlesPlayed) || 0,
      battlesLiveNow: Number(battlesLiveNow),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
// POST /api/stats/increment
// Body: { field: 'playersOnline', amount: 1 }  (amount can be negative)
export const incrementStat = async (req, res) => {
  const { field, amount } = req.body;
  const validFields = ['playersOnline', 'battlesPlayed', 'battlesLiveNow'];
  
  if (!validFields.includes(field) || typeof amount !== 'number') {
    return res.status(400).json({ error: 'Invalid field or amount' });
  }

  try {
    const newValue = await redis.hincrby(STATS_KEY, field, amount);
    res.json({ field, newValue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update stat' });
  }
};