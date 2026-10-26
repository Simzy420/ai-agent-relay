import { handleCredits } from '../lib/credits.mjs';

export function GET(request) {
  return handleCredits(request);
}
