export interface DenoFsFile {
    write(p: Uint8Array): Promise<number>;
    sync(): Promise<void>;
    close(): void;
    tryLock(exclusive?: boolean): Promise<boolean>;
    unlock(): Promise<void>;
}
export interface DenoFileInfo {
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
}
export interface DenoDirEntry {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
}
export interface DenoChildStatus {
    success: boolean;
    code: number;
    signal: string | null;
}
export interface DenoChildProcess {
    readonly pid: number;
    readonly status: Promise<DenoChildStatus>;
    kill(signo?: string): void;
}
export interface DenoCommandOutput extends DenoChildStatus {
    stdout: Uint8Array;
    stderr: Uint8Array;
}
export interface DenoCommandOptions {
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    clearEnv?: boolean;
    stdin?: 'piped' | 'inherit' | 'null';
    stdout?: 'piped' | 'inherit' | 'null';
    stderr?: 'piped' | 'inherit' | 'null';
    signal?: AbortSignal;
}
export interface DenoApi {
    readonly pid: number;
    readonly build: {
        os: string;
    };
    readonly errors: {
        NotFound: new (...a: never[]) => Error;
        AlreadyExists: new (...a: never[]) => Error;
    };
    readonly env: {
        get(name: string): string | undefined;
        toObject(): Record<string, string>;
    };
    open(path: string, options: {
        read?: boolean;
        write?: boolean;
        create?: boolean;
        truncate?: boolean;
        createNew?: boolean;
    }): Promise<DenoFsFile>;
    readFile(path: string): Promise<Uint8Array>;
    readTextFile(path: string): Promise<string>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    writeTextFile(path: string, data: string): Promise<void>;
    mkdir(path: string, options?: {
        recursive?: boolean;
        mode?: number;
    }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    remove(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    stat(path: string): Promise<DenoFileInfo>;
    lstat(path: string): Promise<DenoFileInfo>;
    realPath(path: string): Promise<string>;
    readDir(path: string): AsyncIterable<DenoDirEntry>;
    cwd(): string;
    makeTempDir(options?: {
        prefix?: string;
    }): Promise<string>;
    Command: new (cmd: string, options?: DenoCommandOptions) => {
        spawn(): DenoChildProcess;
        output(): Promise<DenoCommandOutput>;
    };
}
export declare function deno(): DenoApi;
export declare function isNotFound(e: unknown): boolean;
export declare function isAlreadyExists(e: unknown): boolean;
export declare function errorText(e: unknown): string;
/** `$HOME` (`USERPROFILE` on Windows). */
export declare function homeDir(): string | undefined;
export declare function joinPath(...parts: string[]): string;
export declare function parentDir(p: string): string;
export declare function pathExists(p: string): Promise<boolean>;
export declare function isDir(p: string): Promise<boolean>;
/** Write a file and fsync it (`write_file_synced`). */
export declare function writeFileSynced(path: string, bytes: Uint8Array): Promise<void>;
/** fsync a directory so a rename in it is durable (`sync_dir`). */
export declare function syncDir(dir: string): Promise<void>;
//# sourceMappingURL=deno_api.d.ts.map