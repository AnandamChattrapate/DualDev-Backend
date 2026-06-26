import exp from 'express'
import { register, login, me, logout } from '../controllers/UserController.js'

export const UserRouter = exp.Router()

UserRouter.post('/register', register)
UserRouter.post('/login',    login)
UserRouter.get('/me',        me)
UserRouter.post('/logout',   logout)
