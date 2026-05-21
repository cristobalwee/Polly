import { env } from '../env';
import { createEnvelope, parseMasterKey } from './envelope';

/**
 * The process-wide envelope, bound to `ENCRYPTION_MASTER_KEY`.
 *
 * This is the only place the master key is turned into an `Envelope`. The
 * credential routes import `envelope` from here; the trade-poller (next
 * session) will be the only other consumer. The pure crypto in `envelope.ts`
 * stays env-free so it can be unit-tested in isolation.
 */
export const envelope = createEnvelope(parseMasterKey(env.ENCRYPTION_MASTER_KEY));
