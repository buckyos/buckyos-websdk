import { FileObject } from './ndn_types';
import type { FileMediaMeta } from './ndn_types';
/** Upper bound of the bytes read from one file. Past it the group being parsed is dropped. */
export declare const FILE_META_READ_LIMIT: number;
/** Random access to the bytes of a file: exactly `length` bytes at `offset`, or an error. */
export interface FileMetaSource {
    size: number;
    readAt(offset: number, length: number): Promise<Uint8Array> | Uint8Array;
}
export interface ProbeFileMetaOptions {
    /** Gives the extension. Defaults to the name of a `File`. */
    name?: string;
    /** What the caller knows about a file that is not media. Defaults to the type of a `Blob`. */
    declaredMime?: string;
}
/**
 * The common meta of a file: `mime`, display size, duration, codecs, audio tags,
 * capture time, location, camera and exposure, parsed from the bytes without
 * decoding. Never fails: a field that cannot be determined is omitted. Only a
 * size or duration the bytes cannot tell (WebM, MP3) comes from a media element,
 * and only for a `Blob` where there is a DOM.
 */
export declare function probeFileMeta(source: Blob | FileMetaSource, options?: ProbeFileMetaOptions): Promise<FileMediaMeta>;
/** A `cyfile` with the common meta written, ready for `genObjId`. */
export declare function buildFileObject(name: string, size: number, content: string, meta?: FileMediaMeta): FileObject;
//# sourceMappingURL=file_meta.d.ts.map