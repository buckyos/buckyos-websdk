export type JsonSchema = {
    type?: 'object' | 'array' | 'string' | 'boolean' | 'integer' | 'number' | 'null';
    title?: string;
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: unknown[];
    minLength?: number;
    minimum?: number;
    default?: unknown;
    secret?: boolean;
};
export interface PositionalDefinition {
    name: string;
    description: string;
    required?: boolean;
}
export interface OptionDefinition {
    name: string;
    property?: string;
    description: string;
    type: 'string' | 'boolean' | 'integer' | 'number';
    required?: boolean;
    secret?: boolean;
    enum?: string[];
}
export type AccessLevel = 'read' | 'write' | 'destructive' | 'privileged';
/** A usage error with the CLI's code (`UNKNOWN_OPTION`, `SCHEMA_VALIDATION_FAILED`, …). */
export declare class CommandArgsError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function optionProperty(option: OptionDefinition): string;
export interface LongOption {
    name: string;
    inlineValue?: string;
}
export declare function splitLongOption(token: string): LongOption;
export declare function readOptionValue(argv: string[], index: number, option: LongOption): {
    value: string;
    consumed: number;
};
export interface ArgvSpec {
    positionals?: PositionalDefinition[];
    options?: OptionDefinition[];
}
/**
 * Looks at every long option before the command's own: the CLI handles its
 * interactive session options here. Return how many tokens it consumed, or
 * `undefined` to leave the option to the command.
 */
export type LongOptionHook = (option: LongOption, argv: string[], index: number) => number | undefined;
/** Positionals, `--opt value` / `--opt=value`, boolean options, `--`; `--help` / `-h` sets `help`. */
export declare function parseArgv(spec: ArgvSpec, argv: string[], beforeOption?: LongOptionHook): {
    input: Record<string, unknown>;
    help: boolean;
    positionalCount: number;
};
/** Required positionals after `positionalCount` must be in `inputObject`. */
export declare function checkRequiredPositionals(positionals: PositionalDefinition[], positionalCount: number, inputObject: Record<string, unknown> | undefined): void;
export declare function mergeCommandInput(inputObject: Record<string, unknown> | undefined, cliInput: Record<string, unknown>): Record<string, unknown>;
/** Split a command line into words: single and double quotes, backslash escapes (not inside single quotes). */
export declare function parseShellLine(line: string): string[];
export declare function validateSchema(value: unknown, schema: JsonSchema, path: string): void;
//# sourceMappingURL=command_args.d.ts.map