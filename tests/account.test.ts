import { hashPassword, saveLocalAccountInfo, getLocalAccountInfo, cleanLocalAccountInfo } from '../src/account';

// 模拟 buckyos 依赖
jest.mock('../src/index', () => ({
    buckyos: {
        getAppId: () => 'test-app-id',
        getServiceRpcClient: () => ({
            setSeq: jest.fn(),
            call: jest.fn()
        })
    },
    BS_SERVICE_VERIFY_HUB: 'verify-hub'
}));

describe('Account 功能测试', () => {
    beforeEach(() => {
        // 每个测试前清理 localStorage 和 cookie
        window.localStorage.clear();
        document.cookie = '';
    });

    describe('hashPassword', () => {
        it('应该生成正确的密码哈希', () => {
            const username = 'devtest';
            const password = 'bucky2025';
            const hash = hashPassword(username, password);
            
            expect(hash).toBeTruthy();
            expect(typeof hash).toBe('string');
        });

        it('使用 nonce 时应该生成不同的哈希', () => {
            const username = 'devtest';
            const password = 'bucky2025';
            const nonce = Date.now();
            
            const hash1 = hashPassword(username, password, nonce);
            const hash2 = hashPassword(username, password, nonce + 1);
            
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('账户信息存储', () => {
        const mockAccountInfo = {
            user_name: 'testuser',
            user_id: '123',
            user_type: 'normal',
            session_token: 'test-token'
        };

        it('应该正确保存和获取账户信息', () => {
            const appId = 'test-app';
            
            saveLocalAccountInfo(appId, mockAccountInfo);
            const savedInfo = getLocalAccountInfo(appId);
            
            expect(savedInfo).toEqual(mockAccountInfo);
        });
    });
}); 