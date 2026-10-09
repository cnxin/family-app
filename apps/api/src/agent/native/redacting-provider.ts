// 脱敏包装（J4.3）：成员的话、之前的回答、工具结果进模型前过一遍 redactForModel；system 提示里没有家庭数据，不动。
import type { ModelMessage, ModelProvider, ModelRequest } from '@family/agent-core';

export class RedactingProvider implements ModelProvider {
  constructor(
    private readonly inner: ModelProvider,
    private readonly redact: (text: string) => string,
  ) {}

  chat(request: ModelRequest) {
    return this.inner.chat({ ...request, messages: request.messages.map((message) => this.message(message)) });
  }

  private message(message: ModelMessage): ModelMessage {
    switch (message.role) {
      case 'user':
        return { ...message, content: this.redact(message.content) };
      case 'assistant':
        return message.content == null ? message : { ...message, content: this.redact(message.content) };
      case 'tool':
        return { ...message, content: this.redact(message.content) };
      default:
        return message;
    }
  }
}
