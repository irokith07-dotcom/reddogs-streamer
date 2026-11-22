import { FF_ENCODER_LIBSVTAV1, FF_ENCODER_LIBVPX_VP8, FF_ENCODER_LIBVPX_VP9, FF_ENCODER_LIBX264, FF_ENCODER_LIBX265, } from "node-av";
export const software = ({ x264, x265, } = {}) => {
    const { preset: x264Preset = "superfast", tune: x264Tune = "film" } = x264 ?? {};
    const { preset: x265Preset = "superfast", tune: x265Tune } = x265 ?? {};
    return (() => ({
        H264: {
            name: FF_ENCODER_LIBX264,
            options: { "forced-idr": "1", tune: x264Tune, preset: x264Preset },
        },
        H265: {
            name: FF_ENCODER_LIBX265,
            options: {
                "forced-idr": "1",
                ...(x265Tune ? { tune: x265Tune } : {}),
                preset: x265Preset,
            },
        },
        VP8: {
            name: FF_ENCODER_LIBVPX_VP8,
            options: { deadline: "20000" },
        },
        VP9: {
            name: FF_ENCODER_LIBVPX_VP9,
            options: { deadline: "20000" },
        },
        AV1: {
            name: FF_ENCODER_LIBSVTAV1,
            options: {},
        },
    }));
};
//# sourceMappingURL=software.js.map