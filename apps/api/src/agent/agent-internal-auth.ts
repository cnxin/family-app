import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { agentMcpKey } from '../common/config';

export function authorizedAgentInternal(request: Request) {
  const configured = agentMcpKey();
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured, 'utf8');
  const received = Buffer.from(supplied, 'utf8');
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
