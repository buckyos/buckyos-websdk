/** @jest-environment node */

import { AuthClient } from '../../src/auth_client'

describe('AuthClient outside SSO browser environment', () => {
  it('cannot be created in node runtime', () => {
    expect(() => new AuthClient('test.buckyos.io', 'demo-app')).toThrow(
      'AuthClient can only be created in browser SSO environments',
    )
  })
})
