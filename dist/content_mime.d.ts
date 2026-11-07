export declare const TEXT_CODE_EXTENSIONS: string[];
export declare function extensionOf(name: string | undefined): string;
export declare function mediaTypeFromExtension(ext: string): string | undefined;
export declare function stripMediaTypeParams(value: string | undefined | null): string;
/** Returns the confirmed media type of a byte prefix, or null when unknown. */
export declare function sniffMagic(bytes: Uint8Array | null | undefined): string | null;
export interface IsoBox {
    type: string;
    start: number;
    end: number;
}
export declare function isoBoxes(view: DataView, start: number, end: number): IsoBox[];
/**
 * Displayed size of a HEIF / HEIC primary image from the `meta` box of a
 * bounded prefix: the primary item's `ispe`, swapped for a 90°/270° `irot`.
 * Null when the prefix does not hold the box (or the file is no HEIF).
 */
export declare function heifImageSize(bytes: Uint8Array): {
    width: number;
    height: number;
} | null;
//# sourceMappingURL=content_mime.d.ts.map