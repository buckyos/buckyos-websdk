import { aiwsReferenceUrl, parseAiwsReferenceUrl } from '../src/aiworkspace_client'

describe('AI Workspace reference urls', () => {
  it('projects one reference to one url, same as buckyos-api', () => {
    expect(aiwsReferenceUrl({ workspace_id: 'ws_1', entity_id: 'e_1', mode: 'live' })).toBe('obj://aiworkspace/ws_1/entities/e_1')
    const fixed = { entity_id: 'e_1', mode: 'fixed' as const, selector: { b: [1, 2], a: 'x' }, version: { seq: 3, epoch: 'ep' } }
    const url = aiwsReferenceUrl(fixed, 'ws_1')
    expect(url).toBe('obj://aiworkspace/ws_1/entities/e_1?mode=fixed&selector=%7B%22a%22:%22x%22,%22b%22:%5B1,2%5D%7D&version=%7B%22epoch%22:%22ep%22,%22seq%22:3%7D')
    const back = parseAiwsReferenceUrl(url)
    expect(back.selector).toEqual(fixed.selector)
    expect(back.version).toEqual(fixed.version)
    expect(aiwsReferenceUrl(back)).toBe(url)
    const tricky = { entity_id: 'e_1', mode: 'live' as const, selector: { q: 'a&b=c' } }
    expect(parseAiwsReferenceUrl(aiwsReferenceUrl(tricky, 'ws_1')).selector).toEqual(tricky.selector)
    expect(() => parseAiwsReferenceUrl('obj://aiworkspace/ws_1/path/a')).toThrow()
  })
})
