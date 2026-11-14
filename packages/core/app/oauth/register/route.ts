import { registerEndpoint } from '@/lib/server/api-access';
export const POST = (request: Request) => registerEndpoint(request);
