import { z } from 'zod';
import { defineTool, MAX_RESULT_ITEMS, type AgentToolDeps } from './context';

export const getTravelChecklistTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_travel_checklist',
    description: '读取指定计划中行程的协作清单。当用户未指明具体行程且页面上下文未携带行程 ID 时必须先追问，不得自动选择家庭中的任意行程；只有用户明确指定行程或页面上下文提供行程 ID 时才调用本工具',
    kind: 'read',
    schema: z.object({
      travelPlanId: z.string().uuid().optional(),
    }),
    async execute({ user }, input) {
      const planId =
        typeof input.travelPlanId === 'string' ? input.travelPlanId.trim() : '';
      if (!planId) {
        return {
          error: 'travel_plan_id_required',
          message: '缺少 travelPlanId，请先确认用户指的是哪个行程，不得自行选择',
        };
      }
      const plan = await deps.facades.get('travel').planChecklist(planId, user);
      return {
        id: plan.id,
        title: plan.title,
        destination: plan.destination,
        startDate: plan.startDate,
        endDate: plan.endDate,
        status: plan.status,
        items: plan.items.slice(0, MAX_RESULT_ITEMS).map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          quantity: item.quantity,
          status: item.status,
          assignedMemberName: item.assignedMember?.name ?? null,
        })),
        targetPath: `/travel?planId=${plan.id}`,
      };
    },
  });
