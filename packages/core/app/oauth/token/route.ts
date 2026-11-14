import { tokenEndpoint } from '@/lib/server/api-access';
export const POST = (request: Request) => tokenEndpoint(request);
