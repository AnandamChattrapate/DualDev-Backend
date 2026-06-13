import {
  addOnlineUser,
  removeOnlineUser,
  getAllOnlineUsers,
  onlineUsersCount
}
from "../services/onlineUsersService.js";

export const userOnline = async (
  req,
  res,
  next
) => {

  try {

    const { userId } = req.body;

    await addOnlineUser(userId);

    res.json({
      success: true,
      message: "User online"
    });

  } catch (err) {
    next(err);
  }
};

export const userOffline = async (
  req,
  res,
  next
) => {

  try {

    const { userId } = req.body;

    await removeOnlineUser(
      userId
    );

    res.json({
      success: true,
      message: "User offline"
    });

  } catch (err) {
    next(err);
  }
};

export const getOnlineUsers =
  async (
    req,
    res,
    next
  ) => {

    try {

      const users =
        await getAllOnlineUsers();

      res.json({
        success: true,
        users
      });

    } catch (err) {
      next(err);
    }
  };

export const getOnlineCount =
  async (
    req,
    res,
    next
  ) => {

    try {

      const count =
        await onlineUsersCount();

      res.json({
        success: true,
        count
      });

    } catch (err) {
      next(err);
    }
  };