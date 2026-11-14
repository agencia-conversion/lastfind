// Consent (JSON from /app/connect, same origin, signed in): returns the address to send the browser back to the app.
import { authorizeEndpoint } from '@/lib/server/api-access';
export const POST = (request: Request) => authorizeEndpoint(request);
