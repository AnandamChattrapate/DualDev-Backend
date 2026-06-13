import {Queue} from 'bullmq'

import redisConnection from '../config/redis.js'

const submissionQueue=new Queue(
    "submission-queue",
    {
        connection:redisConnection,
    }
)
export default submissionQueue;