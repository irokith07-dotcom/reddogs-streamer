import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { BitStreamFilterAPI, type CodecParameters, type Encoder, type Packet, type Stream } from "node-av";
import { AVCodecID } from "./LibavCodecId.js";
type MediaStreamInfoCommon = {
    index: number;
    codec: AVCodecID;
    codecpar: CodecParameters;
    avStream: Stream;
};
export type VideoStreamInfo = MediaStreamInfoCommon & {
    width: number;
    height: number;
    framerate_num: number;
    framerate_den: number;
};
export type AudioStreamInfo = MediaStreamInfoCommon & {
    sample_rate: number;
};
export declare const allowedVideoCodec: Set<AVCodecID>;
export declare function parseOpusPacketDuration(frame: Uint8Array): number;
type DemuxerOptions = {
    format: "matroska" | "nut";
};
/**
 * Build the bitstream filter chain that turns video packets into the annexb
 * format expected by Discord's RTP packetizer. The mp4 -> annexb filters
 * detect already-annexb input on their own and pass it through untouched.
 *
 * dump_extra runs with freq=keyframe so every keyframe carries the parameter
 * sets. Its default (freq=e) only prepends them to the first packet, which is
 * enough for a container but not for a live stream: a viewer that joins later
 * lands on a keyframe with no SPS/PPS and cannot start decoding.
 */
export declare function createVideoBitStreamFilters(source: Stream | Encoder, codecId: AVCodecID): BitStreamFilterAPI[];
export declare function applyBitStreamFilters(packet: Packet | null, filters: BitStreamFilterAPI[]): Promise<(Packet | null)[]>;
export declare function demux(input: Readable, { format }: DemuxerOptions): Promise<{
    video: {
        index: number;
        codec: AVCodecID;
        codecpar: CodecParameters;
        avStream: Stream;
        width: number;
        height: number;
        framerate_num: number;
        framerate_den: number;
        stream: PassThrough;
    } | undefined;
    audio: {
        index: number;
        codec: AVCodecID;
        codecpar: CodecParameters;
        avStream: Stream;
        sample_rate: number;
        stream: PassThrough;
    } | undefined;
}>;
export {};
