import {
  AGENT_HERMES_CHAT_TIMEOUT_MS,
  AGENT_HERMES_STOP_WAIT_MS,
  AGENT_TOOL_AUTHORIZATION_TTL_MS,
} from '../src/agent/agent.types';

const minimumAuthorizationHeadroomMs = 60_000;
const minimumChatTimeoutMs = 120_000;
const maximumChatTimeoutMs = 300_000;
const headroomMs =
  AGENT_TOOL_AUTHORIZATION_TTL_MS -
  AGENT_HERMES_CHAT_TIMEOUT_MS -
  AGENT_HERMES_STOP_WAIT_MS;

if (
  AGENT_HERMES_CHAT_TIMEOUT_MS < minimumChatTimeoutMs ||
  AGENT_HERMES_CHAT_TIMEOUT_MS > maximumChatTimeoutMs
) {
  throw new Error('Hermes chat 超时必须在 120 至 300 秒之间');
}
if (headroomMs < minimumAuthorizationHeadroomMs) {
  throw new Error(
    'Hermes chat 与停止确认完成后必须至少给工具授权保留 60 秒余量',
  );
}

console.log(
  `Agent 运行时超时契约通过：chat=${AGENT_HERMES_CHAT_TIMEOUT_MS}ms，停止确认=${AGENT_HERMES_STOP_WAIT_MS}ms，授权=${AGENT_TOOL_AUTHORIZATION_TTL_MS}ms，余量=${headroomMs}ms`,
);
