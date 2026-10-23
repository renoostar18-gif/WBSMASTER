import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { projectAccess } from '../permissions.js';

/**
 * GET /api/projects/:projectId/live (WebSocket). Sends presence and "changed"
 * messages; accepts { "type": "select", "itemId": "…" | null } from the page.
 * Close codes: 4401 not signed in, 4404 no access to the project.
 */
export const liveRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/live', { websocket: true }, async (socket, req) => {
    const user = req.user;
    if (!user) { socket.close(4401, 'not_signed_in'); return; }
    try {
      await projectAccess(deps.db, user.id, req.params.projectId);
    } catch {
      socket.close(4404, 'project_not_found');
      return;
    }
    const live = deps.live!;
    const connId = live.join(req.params.projectId, socket, user);
    socket.on('message', raw => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; itemId?: unknown };
        if (msg.type === 'select') live.select(req.params.projectId, connId, typeof msg.itemId === 'string' ? msg.itemId.slice(0, 64) : null);
      } catch { /* ignore malformed messages */ }
    });
    socket.on('close', () => live.leave(req.params.projectId, connId));
  });
};
