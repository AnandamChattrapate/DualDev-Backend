import jwt from "jsonwebtoken"
import { getUserCached } from "../services/userCache.js"

export const authMiddleware = async (req, res, next) => {
  try {
    /* 1. Read token from cookie */
    const token = req.cookies?.token
    if (!token) {
      return res.status(401).json({ success: false, message: "Token not found" })
    }

    /* 2. Verify JWT signature + decode */
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    /* 3. Resolve the user — Redis cache, falls back to Mongo on miss.
          Either path returns the same shape, so downstream is unchanged. */
    const user = await getUserCached(decoded.userId)
    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" })
    }

    /* 4. Attach to req for downstream handlers */
    req.user = user
    req.user.userId = user._id.toString()

    next()
  } catch (err) {
    console.log("AUTH ERROR:", err.message)
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    })
  }
}
