import type { Config } from 'jest';

// Jest 只覆盖 node 环境下可运行的测试：
// - 平铺在 tests/ 下的 ServiceClient 单元/Mock 测试
// - tests/app-client/** 的 AppClient runtime 单元 + 集成测试
// - tests/app-service/** 的 AppService runtime 单元 + 集成测试
// - tests/browser/auth_client.node.test.ts（仅验证 AuthClient 在 node 下拒绝创建）
// Browser runtime 的真实覆盖由 tests/browser/real-browser/playwright.spec.js
// 在真实浏览器里完成；jsdom 模拟环境已经彻底去掉，因为它既拿不到可用的
// session token，也没法驱动真实的 SSO 流程。
const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    // tests/deno/ 是 `deno test` 的用例（test:xllm:deno），jest 不能跑。排除写在
    // testMatch 里而不是 testPathIgnorePatterns：命令行 --testPathIgnorePatterns
    // 会整个替换配置里的忽略列表（发布 workflow 就这么用），那样 deno 用例会被捡回来。
    testMatch: [
        '<rootDir>/tests/**/*.test.ts',
        '<rootDir>/tests/**/*_test.ts',
        '!**/tests/deno/**'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/tests/browser/real-browser/',
        '/tests/browser/xllm/',
    ],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    }
};

export default config;
