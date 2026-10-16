import worker from '../worker/index.js';
import { createHandler } from '../platform/vercel.js';
export default createHandler(worker, { admin: true });
