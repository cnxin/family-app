import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  createTaskBody,
  taskRangeQuery,
  updateTaskBody,
  updateTaskInstanceBody,
  type CreateTaskBody,
  type TaskRangeQuery,
  type UpdateTaskBody,
  type UpdateTaskInstanceBody,
} from '@family/contracts';
import { ZodBody, ZodQuery } from '../common/zod';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get('tasks')
  list(@ZodQuery(taskRangeQuery) query: TaskRangeQuery, @CurrentUser() user: JwtUser) {
    return this.service.list(query.start, query.end, user);
  }

  @Post('tasks')
  create(@ZodBody(createTaskBody) dto: CreateTaskBody, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('tasks/:id')
  update(
    @Param('id') id: string,
    @ZodBody(updateTaskBody) dto: UpdateTaskBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('tasks/:id')
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.archive(id, user);
  }

  @Patch('tasks/:taskId/instances/:dueDate')
  updateOccurrence(
    @Param('taskId') taskId: string,
    @Param('dueDate') dueDate: string,
    @ZodBody(updateTaskInstanceBody) dto: UpdateTaskInstanceBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateOccurrence(taskId, dueDate, dto, user);
  }
}
