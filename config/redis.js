import IORedis from "ioredis";
import { config } from "dotenv";

config();

const redisConnection = new IORedis({
  host:                 process.env.REDIS_HOST,
  port:                 Number(process.env.REDIS_PORT),
  username:             "default",
  password:             process.env.REDIS_PASSWORD,
});

redisConnection.on("connect",     () => console.log("Redis Connected"))
redisConnection.on("ready",       () => console.log("Redis Ready"))
redisConnection.on("error",      (err) => console.log("Redis Error:", err.message))
redisConnection.on("close",       () => console.log("Redis Connection Closed"))
redisConnection.on("reconnecting",() => console.log("Redis Reconnecting..."))

export default redisConnection;