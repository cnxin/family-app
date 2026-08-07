import {
  AGENT_HERMES_CHAT_TIMEOUT_MS,
  AGENT_TOOL_AUTHORIZATION_TTL_MS,
} from '../src/agent/agent.types';

const minimumAuthorizationHeadroomMs = 60_000;
const headroomMs =
  AGENT_TOOL_AUTHORIZATION_TTL_MS - AGENT_HERMES_CHAT_TIMEOUT_MS;

if (AGENT_HERMES_CHAT_TIMEOUT_MS !== 180_000) {
  throw new Error('Hermes chat 超时必须为 180 秒');
}
if (headroomMs < minimumAuthorizationHeadroomMs) {
  throw new Error('Hermes chat 超时必须至少给工具授权保留 60 秒余量');
}

console.log(
  `Agent 运行时超时契约通过：chat=${AGENT_HERMES_CHAT_TIMEOUT_MS}ms，授权=${AGENT_TOOL_AUTHORIZATION_TTL_MS}ms，余量=${headroomMs}ms`,
);
