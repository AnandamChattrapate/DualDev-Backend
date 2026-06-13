import express from "express";

import {
  userOnline,
  userOffline,
  getOnlineUsers,
  getOnlineCount
}
from "../controllers/OnlineUsersController.js";

const router = express.Router();

router.post(
  "/online",
  userOnline
);

router.post(
  "/offline",
  userOffline
);

router.get(
  "/",
  getOnlineUsers
);

router.get(
  "/count",
  getOnlineCount
);

export const OnlineUsersRouter =
  router;