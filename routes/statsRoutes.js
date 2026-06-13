import express from 'express';
import { getStats, incrementStat } from '../controllers/statsController.js';

const router = express.Router();

router.get('/', getStats);
router.post('/increment', incrementStat);

export default router;