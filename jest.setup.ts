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

Object.defineProperty(window, 'localStorage', {
    value: new LocalStorageMock()
});

// 模拟 document.cookie
Object.defineProperty(document, 'cookie', {
    writable: true,
    value: ''
}); 