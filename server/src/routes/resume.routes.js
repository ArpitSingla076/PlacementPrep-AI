import { Router } from 'express';
import * as ctrl from '../controllers/resume.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadSinglePdf } from '../middleware/upload.js';
import { validateQuery, validateObjectId } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';

const router = Router();
router.use(requireAuth); // every resume route is private; handlers always filter by req.user._id

router.get('/', validateQuery(paginationSchema), ctrl.list);
router.post('/', uploadSinglePdf, ctrl.upload); // uploading/parsing needs no AI consent: nothing leaves the server
router.delete('/:id', validateObjectId(), ctrl.remove);

export default router;
