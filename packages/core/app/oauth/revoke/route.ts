import { revokeEndpoint } from '@/lib/server/api-access';
export const POST = (request: Request) => revokeEndpoint(request);
