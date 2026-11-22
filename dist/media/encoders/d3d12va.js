import { FF_ENCODER_AV1_D3D12VA, FF_ENCODER_H264_D3D12VA, FF_ENCODER_HEVC_D3D12VA, } from "node-av";
import { assertPlatformSupported } from "./platform.js";
export function d3d12va({ device } = {}) {
    const props = {
        options: {},
        device,
        outFilters: ["format=nv12|d3d12", "hwupload"],
    };
    return (() => {
        assertPlatformSupported("d3d12va", "win32");
        return {
            H264: {
                name: FF_ENCODER_H264_D3D12VA,
                ...props,
            },
            H265: {
                name: FF_ENCODER_HEVC_D3D12VA,
                ...props,
            },
            AV1: {
                name: FF_ENCODER_AV1_D3D12VA,
                ...props,
            },
        };
    });
}
//# sourceMappingURL=d3d12va.js.map