import { AuthClient } from './auth_client';

describe('AuthClient', () => {


    describe('hash_password', () => {
        it('should hash password correctly without nonce', async () => {
            const username = 'testuser';
            const password = 'testpass';
            
            const result = await AuthClient.hash_password(username, password);
            console.log(result);
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });

        it('should hash password correctly with nonce', async () => {
            const username = 'testuser';
            const password = 'testpass';
            const nonce = 123456;
            
            const result = await AuthClient.hash_password(username, password, nonce);
            console.log(result);
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });
    });



}); 