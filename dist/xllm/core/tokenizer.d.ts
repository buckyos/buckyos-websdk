import type { Tokenizer } from './types';
/** UTF-8 byte length without allocating. */
export declare function utf8Length(s: string): number;
/** 1 token ≈ 4 bytes, rounded up (`ByteHeuristicTokenizer`). */
export declare class ByteHeuristicTokenizer implements Tokenizer {
    countTokens(text: string): number;
}
//# sourceMappingURL=tokenizer.d.ts.map