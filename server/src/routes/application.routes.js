import { Router } from 'express';
import * as ctrl from '../controllers/application.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createApplicationSchema, updateApplicationSchema } from '../validators/application.validators.js';

const router = Router();
router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', validate(createApplicationSchema), ctrl.create);
router.patch('/:id', validate(updateApplicationSchema), ctrl.update); // invalid ids are handled in the service (404)
router.delete('/:id', ctrl.remove);
export default router;
