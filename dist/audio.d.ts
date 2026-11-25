/**
 * Audio an App plays in the background or records. In the BuckyOS client the client does it; in a browser the page's
 * own means stand in. `audioCapabilities` says which one applies.
 */
export interface AudioCapabilities {
    /**
     * `native`: the client keeps the page playing when it is in the background. `media-session`: the system's media
     * controls work, and whether the page goes on playing is up to the browser. `none`: neither.
     */
    background: 'native' | 'media-session' | 'none';
    /** `native`: recorded by the client into a local file. `browser`: recorded by the page and kept in its memory. */
    record: 'native' | 'browser' | 'none';
}
export declare function audioCapabilities(): AudioCapabilities;
export type AudioErrorCode = 'unsupported' | 'denied' | 'busy' | 'not_found' | 'invalid_state' | 'failed';
export declare class AudioError extends Error {
    readonly code: AudioErrorCode;
    constructor(code: AudioErrorCode, message?: string);
}
export interface BackgroundAudioInfo {
    title: string;
    artist?: string;
    /** Address of an image; a relative one is resolved against the page. */
    artwork?: string;
}
export type BackgroundAudioCommand = 'play' | 'pause' | 'stop' | 'next' | 'previous';
export interface BackgroundAudioHandle {
    /** Changes what the system shows; `playing` decides between its play and pause button. */
    update(patch: Partial<BackgroundAudioInfo> & {
        playing?: boolean;
    }): Promise<void>;
    /** Call it when playback is over: until then the client keeps the page alive. */
    release(): Promise<void>;
    /** The user pressed a button of the system's media controls. Returns the function that stops listening. */
    onCommand(handler: (command: BackgroundAudioCommand) => void): () => void;
}
/**
 * Asks to keep this page's sound playing while the page is in the background. The sound still comes from the page (an
 * `<audio>` element). A page holds one handle: acquiring again replaces it, and the earlier one stops having effect.
 */
export declare function acquireBackgroundAudio(info: BackgroundAudioInfo): Promise<BackgroundAudioHandle>;
export interface StartRecordingOptions {
    title?: string;
    sampleRate?: number;
    channels?: 1 | 2;
    bitRate?: number;
}
/** A finished recording. The client keeps it as a local file; in a browser it lasts as long as the page. */
export interface AudioRecording {
    id: string;
    title?: string;
    mime: string;
    size: number;
    durationMs?: number;
    /** Milliseconds since the epoch. */
    createdAt: number;
}
/** `interrupted`: the system took the microphone; the recording can be resumed or stopped. */
export type AudioRecordingState = 'idle' | 'recording' | 'paused' | 'interrupted';
export interface AudioRecordingStatus {
    state: AudioRecordingState;
    /** The recording in progress or, when it just ended by itself, the one that ended. */
    id?: string;
    startedAt?: number;
    /** Recorded time, without pauses. */
    elapsedMs: number;
    /** Why it was interrupted or ended. */
    error?: AudioErrorCode;
}
/** Starts recording the microphone. Rejects with an `AudioError`: `unsupported`, `denied`, `busy`, … */
export declare function startRecording(options?: StartRecordingOptions): Promise<AudioRecordingStatus>;
export declare function pauseRecording(): Promise<AudioRecordingStatus>;
export declare function resumeRecording(): Promise<AudioRecordingStatus>;
export declare function stopRecording(): Promise<AudioRecording>;
export declare function getRecordingStatus(): Promise<AudioRecordingStatus>;
/** This App's finished recordings, newest first. */
export declare function listRecordings(): Promise<AudioRecording[]>;
export declare function getRecording(id: string): Promise<AudioRecording & {
    blob: Blob;
}>;
export declare function deleteRecording(id: string): Promise<void>;
/** Called when the recording starts, pauses, resumes or ends. Returns the function that stops listening. */
export declare function onRecordingState(handler: (status: AudioRecordingStatus) => void): () => void;
//# sourceMappingURL=audio.d.ts.map