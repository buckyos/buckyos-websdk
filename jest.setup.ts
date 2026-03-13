import '@testing-library/jest-dom';

// 模拟 localStorage
class LocalStorageMock {
    private store: { [key: string]: string } = {};

    clear() {
        this.store = {};
    }

    getItem(key: string) {
        return this.store[key] || null;
    }

    setItem(key: string, value: string) {
        this.store[key] = String(value);
    }

    removeItem(key: string) {
        delete this.store[key];
    }
}

if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
        value: new LocalStorageMock()
    });
}

if (typeof document !== 'undefined') {
    Object.defineProperty(document, 'cookie', {
        writable: true,
        value: ''
    });
}
