import bcrypt from "bcrypt";
import User from "../models/UserModel.js";
import jwt from "jsonwebtoken";

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email and password are required",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const saltRounds  = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const newUser = await User.create({ username, email, passwordHash });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        _id:            newUser._id,
        username:       newUser.username,
        email:          newUser.email,
        rating:         newUser.rating,
        wins:           newUser.wins,
        losses:         newUser.losses,
        solvedProblems: newUser.solvedProblems,
        createdAt:      newUser.createdAt,
      },
    });

  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isMatched = await bcrypt.compare(password, user.passwordHash);
    if (!isMatched) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure:   process.env.NODE_ENV === "production",
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      payload: {
        _id:            user._id,
        username:       user.username,
        email:          user.email,
        rating:         user.rating,
        wins:           user.wins,
        losses:         user.losses,
        avatar:         user.avatar,
        solvedProblems: user.solvedProblems,
      },
    });

  } catch (err) {
    console.log("Login ERROR:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// ── NEW — verify cookie and return user ──
export const me = async (req, res) => {
  try {
    console.log("rate guard called /me ")
    const token = req.cookies?.token
    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated" })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    /* Read through the user cache. First call after rating change repopulates
       from Mongo; subsequent calls hit Redis. */
    const { getUserCached } = await import("../services/userCache.js")
    const user = await getUserCached(decoded.userId)

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" })
    }

    /* Live rank from Redis leaderboard. Lazily seed the user if they're not yet
       in the leaderboard so brand-new accounts show up immediately. Best-effort —
       don't fail /me if Redis is unreachable. */
    let rank = null
    try {
      const { getPlayerRank, updatePlayerRating } = await import("../services/leaderboardService.js")
      let r = await getPlayerRank(user._id.toString())
      if (r == null && user.rating != null) {
        await updatePlayerRating({ userId: user._id.toString(), rating: user.rating })
        r = await getPlayerRank(user._id.toString())
      }
      rank = r == null ? null : r + 1
    } catch {}

    return res.status(200).json({
      success: true,
      payload: {
        _id:            user._id,
        username:       user.username,
        email:          user.email,
        rating:         user.rating,
        wins:           user.wins,
        losses:         user.losses,
        avatar:         user.avatar,
        solvedProblems: user.solvedProblems,
        totalMatches:   user.totalMatches || 0,
        accuracy:       user.accuracy     || 0,
        rank,
      }
    })

  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" })
  }
}

// ── NEW — logout ──
export const logout = async (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure:   process.env.NODE_ENV === "production",
  })
  return res.status(200).json({ success: true, message: "Logged out" })
}