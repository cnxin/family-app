// 剧本 provider：把本地确定性助理的剧本（fake-script.ts）翻成模型行为——第一次请求按成员原话发 tool_call，
// 拿到工具结果后按同一个剧本拼正文。只在测试模式下由 AGENT_NATIVE_PROVIDER 选用（native/provider-factory.ts），
// 让全部 agent*.mjs 黑盒在 native 运行时下也能逐字过（J4.2）。
import { ProviderError, type ModelEvent, type ModelProvider, type ModelRequest } from '@family/agent-core';
import { fakeAgentScript } from '../fake-script';

/** 围栏内容（不可信数据）拼在成员原话前面，取最后一个围栏之后的部分。 */
function memberMessage(content: string) {
  const fenceEnd = content.lastIndexOf('\n>>>\n\n');
  return fenceEnd >= 0 ? content.slice(fenceEnd + '\n>>>\n\n'.length) : content;
}

export class ScriptedModelProvider implements ModelProvider {
  async *chat(request: ModelRequest): AsyncGenerator<ModelEvent> {
    if (request.signal?.aborted) throw new ProviderError('aborted', '请求已取消');
    const messages = request.messages;
    let userIndex = messages.length - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex -= 1;
    const last = messages[userIndex];
    const message = last?.role === 'user' ? memberMessage(last.content) : '';
    const tools = new Set((request.tools ?? []).map((tool) => tool.name));
    const step = fakeAgentScript(message, (name) => tools.has(name));
    if (step.kind === 'answer') {
      yield* answer(step.content);
      return;
    }
    const toolMessage = messages.slice(userIndex + 1).find((entry) => entry.role === 'tool');
    if (!toolMessage || toolMessage.role !== 'tool') {
      yield { type: 'tool_call', call: { id: 'scripted-1', name: step.tool, arguments: JSON.stringify(step.args) } };
      yield { type: 'done', finishReason: 'tool_calls', rawFinishReason: 'tool_calls' };
      return;
    }
    const result: unknown = JSON.parse(toolMessage.content);
    const failure = (result as { error?: unknown } | null)?.error;
    if (failure && typeof failure === 'object') {
      // 本地助理遇到工具报错就整次失败；剧本 provider 照此结束，不让循环把错误绕过去
      throw new ProviderError('bad_stream', `剧本工具 ${step.tool} 出错：${(failure as { message?: string }).message ?? ''}`);
    }
    yield* answer(step.render(result));
  }
}

function* answer(content: string): Generator<ModelEvent> {
  yield { type: 'text_delta', text: content };
  yield { type: 'done', finishReason: 'stop', rawFinishReason: 'stop' };
}
