/**
 * Login failure message mapping (2026-11-02 review P2-5). The login fetch
 * used to render "账号或密码错误" for every non-OK status — a throttled user
 * (429) kept retrying a correct password, and a transport failure showed
 * nothing at all (unhandled rejection).
 *
 * `status` is the HTTP status; `null` means the request never got a response
 * (network down / DNS / unreachable server).
 */
export function loginErrorMessage(status: number | null): string {
  if (status === null) return '网络异常：无法连接服务器，请检查网络后重试';
  if (status === 429) return '尝试过于频繁：登录已限流，请稍后再试';
  if (status === 401) return '登录失败：账号或密码错误';
  return `登录失败：服务异常（${status}），请稍后重试`;
}
