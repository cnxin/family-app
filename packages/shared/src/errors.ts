// 框架无关的领域错误。API 的 AllExceptionsFilter 会把它们映射为对应的 HTTP 状态与
// `{ error: { code, message } }` 响应；code 与 NestJS 内置异常保持一致，
// 这样旧模块换用这些错误类时，黑盒测试看到的响应不变。

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(400, 'Bad Request', message);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = '未登录') {
    super(401, 'Unauthorized', message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super(403, 'Forbidden', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(404, 'Not Found', message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(409, 'Conflict', message);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
