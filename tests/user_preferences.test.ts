import { readUserPreferences, setFrameAppearance, UserPreferencesStore, type UserPreferences } from '../src/user_preferences'

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

/** A Zone whose answer the test sets, and a page the test brings to the foreground. */
function setup(first: UserPreferences | Error) {
  let answer: UserPreferences | Error = first
  let reads = 0
  const foreground = new Set<() => void>()
  const store = new UserPreferencesStore(
    async () => {
      reads += 1
      if (answer instanceof Error) throw answer
      return answer
    },
    (callback) => { foreground.add(callback); return () => { foreground.delete(callback) } },
  )
  return {
    store,
    reads: () => reads,
    answer: (next: UserPreferences | Error) => { answer = next },
    comeBack: async () => { foreground.forEach((callback) => callback()); await flush() },
    foreground,
  }
}

afterEach(() => setFrameAppearance(null))

describe('user preferences', () => {
  it('keeps the usable fields of an answer', () => {
    expect(readUserPreferences({ theme: 'dark', accent: '#0F7F8C', locale: 'zh-CN', profile: { name: 'Alice' }, iconSize: 'large' }))
      .toEqual({ theme: 'dark', accent: '#0f7f8c', locale: 'zh-CN', profile: { name: 'Alice' } })
    expect(readUserPreferences({ theme: 'sepia', accent: 'blue', locale: 'en US', profile: 'Alice', private_profile: [] })).toEqual({})
    expect(readUserPreferences({ accent: null })).toEqual({ accent: null })
    expect(readUserPreferences(null)).toEqual({})
  })

  it('answers with the Zone alone in a tab, and with the host in a frame', async () => {
    const { store } = setup({ theme: 'dark', accent: '#0f7f8c', locale: 'zh-CN', profile: { name: 'Alice' } })
    expect(await store.get()).toEqual({ theme: 'dark', accent: '#0f7f8c', locale: 'zh-CN', profile: { name: 'Alice' } })
    // a host may show the page otherwise than the account says; the profile still comes from the Zone
    setFrameAppearance({ theme: 'light', locale: 'fr' })
    expect(await store.get()).toEqual({ theme: 'light', accent: null, locale: 'fr', profile: { name: 'Alice' } })
  })

  it('tells listeners what changed when the page comes back, and only then', async () => {
    const { store, answer, comeBack, foreground, reads } = setup({ theme: 'light' })
    const heard: UserPreferences[] = []
    const stop = store.subscribe((preferences) => heard.push(preferences))
    await flush()
    expect(reads()).toBe(1)
    await comeBack()
    expect(heard).toEqual([])
    answer({ theme: 'dark' })
    await comeBack()
    expect(heard).toEqual([{ theme: 'dark' }])
    // a failed read keeps what was known
    answer(new Error('offline'))
    await comeBack()
    expect(heard).toEqual([{ theme: 'dark' }])
    expect(await store.get()).toEqual({ theme: 'dark' })
    stop()
    expect(foreground.size).toBe(0)
  })

  it('tells listeners when the host changes the appearance', async () => {
    const { store } = setup({ theme: 'light', locale: 'en' })
    const heard: UserPreferences[] = []
    store.subscribe((preferences) => heard.push(preferences))
    await flush()
    setFrameAppearance({ theme: 'dark', accent: '#112233', locale: 'en' })
    setFrameAppearance({ theme: 'dark', accent: '#112233', locale: 'en' })
    expect(heard).toEqual([{ theme: 'dark', accent: '#112233', locale: 'en' }])
  })

  it('reads once for callers at the same time', async () => {
    const { store, reads } = setup({ theme: 'light' })
    await Promise.all([store.get(), store.get(), store.get()])
    expect(reads()).toBe(1)
  })
})
