import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Run a paginated query. Always pass a filter that includes userId so one user can never page through another's data. */
export async function paginate(Model, filter, { page, limit }, { sort = { createdAt: -1 }, select } = {}) {
  const [items, total] = await Promise.all([
    Model.find(filter).select(select ?? '').sort(sort).skip((page - 1) * limit).limit(limit),
    Model.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}
