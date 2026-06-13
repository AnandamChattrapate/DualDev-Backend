import Redis from "ioredis";
import { config } from "dotenv";

config();

const matchmakingRedis = new Redis({
  host:     process.env.REDIS2_HOST,
  port:     Number(process.env.REDIS2_PORT),
  username: "default",
  password: process.env.REDIS2_PASSWORD,
  // no tls
});

matchmakingRedis.on("connect", () => console.log("Matchmaking Redis Connected"))
matchmakingRedis.on("error",  (err) => console.log("Matchmaking Redis Error:", err.message))

export default matchmakingRedis;