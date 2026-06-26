[33mcommit 0e1761cb4b85191b2a9d89a6d399faaf4e49e37f[m[33m ([m[1;31morigin/main[m[33m, [m[1;31morigin/HEAD[m[33m)[m
Author: AnandamChattrapate <23eg105e05@anurag.edu.in>
Date:   Sun May 31 23:01:25 2026 +0530

    bug fixes

 config/leaderboardRedis.js           |   32 [32m+[m[31m-[m
 config/matchmakingRedis.js           |   32 [32m+[m[31m-[m
 config/redis.js                      |   36 [32m+[m[31m-[m
 controllers/AIController.js          |   66 [32m+[m[31m-[m
 controllers/LeaderboardController.js |  130 [32m+[m[31m--[m
 controllers/MatchStateController.js  |  283 [32m+++[m[31m--[m
 controllers/MatchmakingController.js |  522 [32m++++[m[31m-----[m
 controllers/OnlineUsersController.js |  192 [32m+[m[31m--[m
 controllers/UserController.js        |  312 [32m++[m[31m---[m
 controllers/statsController.js       |  106 [32m+[m[31m-[m
 handlers/matchEndHandler.js          |  273 [32m++[m[31m---[m
 middlewares/authMiddleware.js        |   46 [32m+[m[31m-[m
 models/MatchModel.js                 |  148 [32m+[m[31m--[m
 models/ProblemModel.js               |  292 [32m++[m[31m---[m
 models/SubmissionModel.js            |  186 [32m+[m[31m--[m
 models/UserModel.js                  |  200 [32m++[m[31m--[m
 package-lock.json                    | 4744 [32m+++++++++++++++++++++++++++++++++++++[m[31m-------------------------------------[m
 package.json                         |   62 [32m+[m[31m-[m
 producers/submissionQueue.js         |   20 [32m+[m[31m-[m
 routes/AIRouter.js                   |   12 [32m+[m[31m-[m
 routes/LeaderboardRouter.js          |   29 [32m+[m[31m-[m
 routes/MatchStateRouter.js           |   44 [32m+[m[31m-[m
 routes/MatchmakingRouter.js          |   40 [32m+[m[31m-[m
 routes/OnlineUsersRouter.js          |   66 [32m+[m[31m-[m
 routes/ProblemRouter.js              |    6 [32m+[m[31m-[m
 routes/SubmissionRouter.js           |   70 [32m+[m[31m-[m
 routes/UserRouter.js                 |   16 [32m+[m[31m-[m
 routes/statsRoutes.js                |   16 [32m+[m[31m-[m
 server.js                            |  600 [32m+++++[m[31m-----[m
 services/leaderboardService.js       |  122 [32m+[m[31m-[m
 services/matchStateService.js        |  303 [32m++[m[31m---[m
 services/matchmakingService.js       |  228 [32m++[m[31m--[m
 services/onlineUsersService.js       |   78 [32m+[m[31m-[m
 services/userCache.js                |   69 [32m++[m
 socket/registerSocketHandlers.js     |  275 [32m+++[m[31m--[m
 utils/aiJudge.js                     |  200 [32m++[m[31m--[m
 utils/selectProblem.js               |  350 [32m+++[m[31m---[m
 37 files changed, 5247 insertions(+), 4959 deletions(-)
