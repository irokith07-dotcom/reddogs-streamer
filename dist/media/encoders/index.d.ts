import type { AVHWDeviceType, FFEncoderCodec, UnknownEncoderOptions } from "node-av";
import type { SupportedVideoCodec } from "../../utils.js";
export type EncoderSettings = {
    name: FFEncoderCodec;
    options: UnknownEncoderOptions;
    /**
     * Hardware device used for encoding, e.g. "/dev/dri/renderD129" for VAAPI.
     * The hardware type itself is deduced from the encoder name; leave unset to
     * use the system default device.
     */
    device?: string;
    outFilters?: string[];
};
/**
 * Hardware info deduced from the encoder name suffix, e.g. "h264_vaapi" ->
 * VAAPI, "hevc_nvenc" -> CUDA. Encoders not listed here accept system memory
 * frames and self-manage their hardware contexts.
 */
export type HardwareEncoderInfo = {
    /** Hardware device type used for the device context */
    deviceType: AVHWDeviceType;
    /** Hardware scale filter */
    scaleFilter: string;
};
export declare function hardwareForEncoder(name: string): HardwareEncoderInfo | null;
export type EncoderSettingsGetter = (bitrate: number, bitrateMax: number) => Partial<Record<SupportedVideoCodec, EncoderSettings>>;
import { amf } from "./amf.js";
import { d3d12va } from "./d3d12va.js";
import { merge } from "./merge.js";
import { nvenc } from "./nvenc.js";
import { qsv } from "./qsv.js";
import { software } from "./software.js";
import { v4l2m2m } from "./v4l2m2m.js";
import { vaapi } from "./vaapi.js";
import { videotoolbox } from "./videotoolbox.js";
declare const Encoders: {
    software: typeof software;
    nvenc: typeof nvenc;
    vaapi: typeof vaapi;
    qsv: typeof qsv;
    videotoolbox: typeof videotoolbox;
    amf: typeof amf;
    v4l2m2m: typeof v4l2m2m;
    d3d12va: typeof d3d12va;
    merge: typeof merge;
};
export { Encoders };
