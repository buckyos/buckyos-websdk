import { AccountInfo } from "./account";


export class AuthClient {
    zone_hostname:string;
    clientId:string;
    cookieOptions:any;
    authWindow:Window | null;


    constructor(zone_base_url:string, appId:string) {
        this.zone_hostname = zone_base_url;
        this.clientId = appId;
        this.authWindow = null;

    }


    async login(redirect_uri:string|null=null) : Promise<AccountInfo|null> {
        try {
            const token = await this._openAuthWindow(redirect_uri);
            let account_info = JSON.parse(token) as AccountInfo;
            return account_info;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Login failed');
            throw new Error(message);
        }
    }

    async request(action:string,params:any){
        //let token = await this.login();
        //return token;
    }

    async _openAuthWindow(redirect_uri:string|null=null) : Promise<string> {
        return new Promise((resolve, reject) => {
            const width = 500;
            const height = 600;
            const left = (window.screen.width / 2) - (width / 2);
            const top = (window.screen.height / 2) - (height / 2);
            let sso_url = window.location.protocol + "//sys." + this.zone_hostname + "/login.html";
            //console.log("sso_url: ", sso_url);
            
            const redirectTarget = redirect_uri ?? window.location.href;
            const authUrl = `${sso_url}?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(redirectTarget)}&response_type=token`;
            alert(authUrl);
            this.authWindow = window.open(authUrl, 'BuckyOS Login', `width=${width},height=${height},top=${top},left=${left}`);

            //TODO: how to get this message?
            window.addEventListener('message', (event) => {
                console.log("message event",event);
                if (event.origin !== new URL(sso_url).origin) {
                    return;
                }

                const { token, error } = event.data;

                if (token) {
                    
                    resolve(token);
                } else {
                    reject(error || 'BuckyOSLogin failed');
                }

                if (this.authWindow) {
                    this.authWindow.close();
                }
            }, false);
        });
    }

}
