import { slugProblem } from '@/components/analytics/app-routes';
import { ApiError } from './http';

/** A slug typed in Settings (a workspace's, a project's), checked: its format and the reserved words (app-routes.ts). */
export function slugInput(value: unknown): string {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const problem = slugProblem(slug);
  if (problem === 'format') throw new ApiError(400, 'Use lowercase letters, numbers and single hyphens, up to 48 characters.');
  if (problem === 'reserved') throw new ApiError(400, 'This address is reserved. Choose another.');
  return slug;
}
