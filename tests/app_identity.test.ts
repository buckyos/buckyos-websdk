import {
  appDidFromId,
  appIdFromDid,
  createAppInstanceId,
  parseAppId,
  parseAppInstanceId,
} from '../src/app_identity'

describe('AppDID/AppId/AppInstanceId', () => {
  test.each([
    ['did:web:filebrowser.buckyos.ai', 'filebrowser.buckyos.ai'],
    ['did:bns:filebrowser.buckyos', 'filebrowser.buckyos.bns.did'],
  ])('round trips %s through its raw hostname', (appDid, appId) => {
    expect(appIdFromDid(appDid)).toBe(appId)
    expect(parseAppId(appId)).toBe(appId)
    expect(appDidFromId(appId)).toBe(appDid)
  })

  test('creates and parses the canonical owner-scoped instance id', () => {
    const appInstanceId = createAppInstanceId('filebrowser.buckyos.bns.did', 'alice')

    expect(appInstanceId).toBe('filebrowser.buckyos.bns.did@alice')
    expect(parseAppInstanceId(appInstanceId)).toEqual({
      appId: 'filebrowser.buckyos.bns.did',
      ownerUserId: 'alice',
    })
  })

  test.each([
    'FileBrowser.buckyos.ai',
    'filebrowser.buckyos.ai/path',
    'filebrowser.buckyos.ai:443',
  ])('rejects a non-canonical AppId: %s', (appId) => {
    expect(() => parseAppId(appId)).toThrow()
  })

  test('rejects reserved did:web .did hostnames and invalid owners', () => {
    expect(() => appIdFromDid('did:web:filebrowser.bns.did')).toThrow(
      'did:web hostnames ending in `.did` are reserved',
    )
    expect(() => createAppInstanceId('filebrowser.buckyos.ai', 'Alice')).toThrow(
      'owner_user_id must be lowercase ASCII',
    )
  })
})
