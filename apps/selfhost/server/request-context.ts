export function withRequestContext<T>(_request: Request, action: () => T): T { return action(); }
