import type { JsonValue } from '../core/types';
import type { DIDObjectClient } from '../../did_object_client';
import type { ActionRisk, ResourceDecl } from './site_tools';
export declare const INDEX_TRAIT_URI = "https://buckyos.org/traits/index@1";
/** What `didObjectResources` needs of a DID Object client. */
export type DidObjectReader = Pick<DIDObjectClient, 'card' | 'profile' | 'readProperty' | 'invoke'>;
export interface DidObjectResourcesOptions {
    client: DidObjectReader;
    /** Object URLs (`obj://…`) the page lets the model reach. */
    roots: string[];
    /** Actions above this risk are not exposed (default `read_only`). */
    maxRisk?: ActionRisk;
}
/** The object document a read shows (as `render_object_document` in agent-did-object-lib). */
export declare function renderObjectDocument(canonical: string, card: {
    id: string;
    alsoKnownAs?: string[];
}, profile: JsonValue, summary: Record<string, JsonValue>): string;
/** Resources for `siteTools({ resources })` from the Profiles of `roots`. */
export declare function didObjectResources(options: DidObjectResourcesOptions): Promise<Record<string, ResourceDecl>>;
//# sourceMappingURL=did_object_resources.d.ts.map