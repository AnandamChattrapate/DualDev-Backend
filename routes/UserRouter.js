import exp from 'express'
import { register, login, me, logout } from '../controllers/UserController.js'
import {rateGuard} from 'rateguard-sdk';
export const UserRouter = exp.Router()

// const router = express.Router();


//rate limiter
const limiter = rateGuard({
  apiKey: process.env.RATEGUARD_KEY,
  baseUrl: "https://rateguard-yfcb.onrender.com/api"
});

UserRouter.post('/register', register)
UserRouter.post('/login',    login)
UserRouter.get('/me',me)       // ← new
UserRouter.post('/logout',   logout)   // ← new