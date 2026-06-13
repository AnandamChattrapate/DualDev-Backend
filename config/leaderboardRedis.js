import Redis from "ioredis";
import { config } from "dotenv";

config();

const leaderboardRedis = new Redis({
  host:     process.env.REDIS2_HOST,
  port:     Number(process.env.REDIS2_PORT),
  username: "default",
  password: process.env.REDIS2_PASSWORD,
  // no tls
});

leaderboardRedis.on("connect", () => console.log("Leaderboard Redis Connected"))
leaderboardRedis.on("error",  (err) => console.log("Leaderboard Redis Error:", err.message))

export default leaderboardRedis;  