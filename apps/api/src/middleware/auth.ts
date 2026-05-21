import { createMiddleware } from 'hono/factory';
import { auth } from '../auth';

/** The authenticated principal attached to a request by `requireAuth`. */
export type AuthedUser = { id: string; email: string };

/** Hono `Variables` contributed by `requireAuth` — `c.get('user')` is typed. */
export type AuthVariables = { user: AuthedUser };

/**
 * Gate a route behind a valid Better Auth session.
 *
 * Resolves the session from the request (httpOnly cookie on web, or the
 * SecureStore-backed cookie / bearer token on native). On success the user is
 * stashed on the context; otherwise the request is rejected with 401 before
 * the handler runs. Every `/credentials/*` route mounts this.
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('user', { id: session.user.id, email: session.user.email });
    await next();
  },
);
