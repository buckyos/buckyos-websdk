import { getImportProvider } from '../src/ndm_client'

class PickerInput extends EventTarget {
    type = ''
    multiple = false
    accept = ''
    files: File[] = []
    click = jest.fn()
    get webkitdirectory(): boolean { return this.directory }
    set webkitdirectory(value: boolean) { this.directory = value }
    private directory = false
}

describe('NDM browser picker', () => {
    const provider = getImportProvider()
    const globals = ['document', 'window', 'HTMLInputElement'] as const
    let originalGlobals: Array<PropertyDescriptor | undefined>
    let input: PickerInput
    let windowEvents: EventTarget

    beforeEach(() => {
        jest.useFakeTimers()
        originalGlobals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
        input = new PickerInput()
        windowEvents = new EventTarget()
        Object.defineProperties(globalThis, {
            document: { configurable: true, value: { createElement: () => input } },
            window: { configurable: true, value: windowEvents },
            HTMLInputElement: { configurable: true, value: PickerInput },
        })
    })

    afterEach(() => {
        globals.forEach((name, index) => {
            const descriptor = originalGlobals[index]
            if (descriptor) Object.defineProperty(globalThis, name, descriptor)
            else delete (globalThis as Record<string, unknown>)[name]
        })
        jest.useRealTimers()
    })

    it('waits for directory enumeration after focus returns before change', async () => {
        const result = provider.pickFiles({ mode: 'single_dir' })
        const settled = jest.fn()
        void result.then(settled, settled)
        expect(input.webkitdirectory).toBe(true)
        expect(input.click).toHaveBeenCalledTimes(1)

        windowEvents.dispatchEvent(new Event('focus'))
        await jest.advanceTimersByTimeAsync(2000)
        expect(settled).not.toHaveBeenCalled()

        const file = new File(['payload'], 'leaf.txt')
        Object.defineProperty(file, 'webkitRelativePath', { value: 'root/nested/leaf.txt' })
        input.files = [file]
        input.dispatchEvent(new Event('change'))
        await expect(result).resolves.toEqual([file])
        expect((await result)[0].webkitRelativePath).toBe('root/nested/leaf.txt')
    })

    it('rejects native cancellation and removes picker and abort listeners', async () => {
        const controller = new AbortController()
        const removeInputListener = jest.spyOn(input, 'removeEventListener')
        const removeAbortListener = jest.spyOn(controller.signal, 'removeEventListener')
        const result = provider.pickFiles({ mode: 'single_dir', signal: controller.signal })
        input.dispatchEvent(new Event('cancel'))
        await expect(result).rejects.toMatchObject({ code: 'USER_CANCELLED' })
        expect(removeInputListener).toHaveBeenCalledWith('change', expect.any(Function))
        expect(removeInputListener).toHaveBeenCalledWith('cancel', expect.any(Function))
        expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it('allows explicit abort while directory selection is pending', async () => {
        const controller = new AbortController()
        const result = provider.pickFiles({ mode: 'single_dir', signal: controller.signal })
        controller.abort()
        await expect(result).rejects.toMatchObject({ code: 'USER_CANCELLED', message: 'Import cancelled' })
    })

    it('does not open the picker when the signal is already aborted', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(provider.pickFiles({ mode: 'single_dir', signal: controller.signal }))
            .rejects.toMatchObject({ code: 'USER_CANCELLED' })
        expect(input.click).not.toHaveBeenCalled()
    })

    it('reports an empty directory separately from cancellation', async () => {
        const result = provider.pickFiles({ mode: 'single_dir' })
        input.dispatchEvent(new Event('change'))
        await expect(result).rejects.toMatchObject({ code: 'EMPTY_DIRECTORY_UNAVAILABLE' })
    })

    it('cleans up after a successful file selection', async () => {
        const controller = new AbortController()
        const removeInputListener = jest.spyOn(input, 'removeEventListener')
        const removeAbortListener = jest.spyOn(controller.signal, 'removeEventListener')
        const result = provider.pickFiles({ mode: 'multi_file', signal: controller.signal, accept: ['text/plain'] })
        expect(input.multiple).toBe(true)
        expect(input.accept).toBe('text/plain')
        input.files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]
        input.dispatchEvent(new Event('change'))
        await expect(result).resolves.toEqual(input.files)
        expect(removeInputListener).toHaveBeenCalledWith('change', expect.any(Function))
        expect(removeInputListener).toHaveBeenCalledWith('cancel', expect.any(Function))
        expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
    })
})
