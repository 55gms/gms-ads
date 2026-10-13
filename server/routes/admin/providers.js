import { Router } from 'express';
import { HttpError, asyncHandler, requireRole } from '../../middleware/auth.js';
import { audit } from '../../services/audit.js';
import { listProviders, updateProvider } from '../../services/video/providers.js';

export const providersRouter = Router();

providersRouter.get('/', asyncHandler(async (_req, res) => res.json({ providers: await listProviders() })));

providersRouter.patch(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    if (!/^[a-z0-9_]{2,40}$/.test(req.params.id)) throw new HttpError(404, 'not_found', 'Provider not found');
    if (req.params.id === 'first_party' && req.body.enabled === false) {
      throw new HttpError(400, 'first_party', 'First-party campaigns are switched off per campaign, not here');
    }
    const provider = await updateProvider(req.params.id, req.body);
    audit(req, 'provider.updated', 'provider', provider.id, { enabled: provider.enabled, formats: provider.formats });
    res.json({ provider });
  })
);
