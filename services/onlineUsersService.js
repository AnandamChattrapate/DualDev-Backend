// import matchmakingRedis from "../config/matchmakingRedis.js";

export const addOnlineUser = async (
  userId
) => {

  await matchmakingRedis.sadd(
    "onlineUsers",
    userId
  );

  return true;
};

export const removeOnlineUser =
  async userId => {

    await matchmakingRedis.srem(
      "onlineUsers",
      userId
    );

    return true;
  };

export const getAllOnlineUsers =
  async () => {

    return await matchmakingRedis.smembers(
      "onlineUsers"
    );
  };

export const onlineUsersCount =
  async () => {

    return await matchmakingRedis.scard(
      "onlineUsers"
    );
  };