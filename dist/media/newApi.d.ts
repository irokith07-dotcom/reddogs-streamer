import { Readable } from "node:stream";
import { type Stream } from "node-av";
import type { Streamer } from "../client/index.js";
import type { SupportedVideoCodec } from "../utils.js";
import type { EncoderSettingsGetter } from "./encoders/index.js";
import { type AudioStreamInfo, type VideoStreamInfo } from "./LibavDemuxer.js";
export type PrepareStreamOptions = {
    /**
     * Disable video transcoding
     * If enabled, all video related settings have no effects, and the input
     * video stream is used as-is.
     *
     * You need to ensure that the video stream has the right properties
     * (keyframe every 1s, B-frames disabled). Failure to do so will result in
     * a glitchy stream, or degraded performance
     */
    noTranscoding: boolean;
    /**
     * Video width
     */
    width: number;
    /**
     * Video height
     */
    height: number;
    /**
     * Video frame rate
     */
    frameRate?: number;
    /**
     * Video codec
     */
    videoCodec: SupportedVideoCodec;
    /**
     * Video average bitrate in kbps
     */
    bitrateVideo: number;
    /**
     * Video max bitrate in kbps
     */
    bitrateVideoMax: number;
    /**
     * Audio bitrate in kbps
     */
    bitrateAudio: number;
    /**
     * Initial audio volume multiplier (1.0 = original volume)
     */
    volume: number;
    /**
     * Start playback at this position, in seconds
     */
    startPosition: number;
    /**
     * Select the video stream to play, from the video streams present in the
     * input. Return null to disable video output
     */
    videoStream: (streams: Stream[]) => Stream | null;
    /**
     * Select the audio stream to play, from the audio streams present in the
     * input. Return null to disable audio output
     */
    audioStream: (streams: Stream[]) => Stream | null;
    /**
     * Functions to get encoder settings
     * This function will receive the average and max bitrate as the input, and
     * returns an object containing encoder settings for the supported codecs
     */
    encoder: EncoderSettingsGetter;
    /**
     * Add some options to minimize latency
     */
    minimizeLatency: boolean;
    /**
     * Custom headers for HTTP requests
     */
    customHeaders: Record<string, string>;
    /**
     * Custom input options to pass directly to ffmpeg
     * These will be added to the command before other options
     *
     * NOTE: this option only applies to the ffmpeg CLI, and is ignored when
     * transcoding in-process
     */
    customInputOptions: string[];
    /**
     * Custom ffmpeg flags/options to pass directly to ffmpeg
     * These will be added to the command after other options
     *
     * NOTE: this option only applies to the ffmpeg CLI, and is ignored when
     * transcoding in-process
     */
    customFfmpegFlags: string[];
};
export type Controller = {
    volume: number;
    setVolume(newVolume: number): Promise<boolean>;
    /**
     * Seek the stream to the given position in seconds.
     * The transport timestamps are kept continuous so audio/video stays in
     * sync and playback pacing is unaffected.
     *
     * The position is not set here: it is tracked from the encoded packets
     * (see PlaybackState.position), which, once the post-seek content starts
     * flowing, come from the encoder with their post-seek timestamps.
     */
    seek(positionSeconds: number): Promise<boolean>;
    /**
     * Current playback position in seconds, tracked from the encoded packets
     */
    readonly position: number | undefined;
    /**
     * Total duration in seconds, if known
     */
    readonly duration: number | undefined;
};
export type PreparedStream = {
    /**
     * The encoded video packet stream, ready to be sent to Discord
     */
    video?: VideoStreamInfo & {
        stream: Readable;
    };
    /**
     * The encoded audio packet stream, ready to be sent to Discord
     */
    audio?: AudioStreamInfo & {
        stream: Readable;
    };
};
export type PrepareStreamResult = {
    output: PreparedStream;
    /**
     * Resolves when the transcode pipeline finished processing the input,
     * rejects when the pipeline failed or was cancelled
     */
    promise: Promise<unknown>;
    controller: Controller;
};
export declare function prepareStream(input: string | Readable, options?: Partial<PrepareStreamOptions>, cancelSignal?: AbortSignal): Promise<PrepareStreamResult>;
export type PlayStreamOptions = {
    /**
     * Set stream type as "Go Live" or camera stream or audio player
     */
    type: "go-live" | "camera" | "cam" | "audio";
    /**
     * Set format of the stream
     */
    format: "matroska" | "nut";
    /**
     * Override video width sent to Discord.
     *
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    width: number | ((v: VideoStreamInfo) => number);
    /**
     * Override video height sent to Discord.
     *
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    height: number | ((v: VideoStreamInfo) => number);
    /**
     * Override video frame rate sent to Discord.
     *
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    frameRate: number | ((v: VideoStreamInfo) => number);
    /**
     * Same as ffmpeg's `readrate_initial_burst` command line flag
     *
     * See https://ffmpeg.org/ffmpeg.html#:~:text=%2Dreadrate_initial_burst
     */
    readrateInitialBurst: number | undefined;
    /**
     * Enable stream preview from input stream (experimental)
     */
    streamPreview: boolean;
    /**
     * Keep stream alive on finish (useful for seamless looping)
     */
    keepStreamAlive?: boolean;
};
export declare function playStream(input: Readable | PreparedStream, streamer: Streamer, options?: Partial<PlayStreamOptions>, cancelSignal?: AbortSignal): Promise<void>;
