import { currentUser } from '@/lib/server/auth';
import { avatarResponse } from '@/lib/server/avatar-image';

export async function GET() {
  return avatarResponse(currentUser);
}
