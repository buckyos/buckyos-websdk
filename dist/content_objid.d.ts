import { type LocalFile, type ZoneContent } from './content';
import { type StartUploadOptions } from './ndm_client';
export interface EnsureObjIdOptions extends Pick<StartUploadOptions, 'endpoint' | 'sessionToken' | 'fetcher' | 'headers' | 'signal'> {
}
/**
 * The object ID of an item the system file picker returned: the one it already carries, or one computed and
 * registered in the Zone. A file from this device goes through `ndm.importFiles` + `ndm.ensureUploaded`; call
 * `release()` once your own data references the object. A Zone item without an ID needs the server-side `snapshot`
 * of nfs_server, which this Zone does not offer yet: that case rejects with `SystemDialogError('unsupported')`.
 */
export declare function ensureObjId(item: ZoneContent | LocalFile, options?: EnsureObjIdOptions): Promise<{
    objId: string;
    release(): void;
}>;
//# sourceMappingURL=content_objid.d.ts.map