export function withRequestContext<T>(
  request: Request,
  action: (contextRequest: Request) => T,
): T {
  return action(request);
}
