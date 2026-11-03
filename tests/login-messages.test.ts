import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from '../src/lib/login-messages';

/**
 * P2-5 regression: every non-OK login response used to render
 * "账号或密码错误" and a transport failure rendered nothing. The mapping must
 * keep 429 (throttled) and transport failure (null) visibly distinct from a
 * wrong-password 401.
 */
describe('loginErrorMessage (P2-5)', () => {
  it('401 keeps the wrong-credentials message', () => {
    expect(loginErrorMessage(401)).toBe('登录失败：账号或密码错误');
  });

  it('429 says throttled, never blames the password', () => {
    const msg = loginErrorMessage(429);
    expect(msg).toContain('限流');
    expect(msg).not.toContain('账号或密码错误');
  });

  it('null (transport failure) reports a network problem', () => {
    expect(loginErrorMessage(null)).toContain('网络异常');
  });

  it('other statuses surface the status code instead of blaming credentials', () => {
    const msg = loginErrorMessage(503);
    expect(msg).toContain('503');
    expect(msg).not.toContain('账号或密码错误');
  });
});
