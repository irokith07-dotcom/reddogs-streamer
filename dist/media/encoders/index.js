import { AV_HWDEVICE_TYPE_AMF, AV_HWDEVICE_TYPE_CUDA, AV_HWDEVICE_TYPE_D3D12VA, AV_HWDEVICE_TYPE_QSV, AV_HWDEVICE_TYPE_VAAPI, AV_HWDEVICE_TYPE_VIDEOTOOLBOX, AV_HWDEVICE_TYPE_VULKAN, } from "node-av";
const hardwareBySuffix = {
    vaapi: { deviceType: AV_HWDEVICE_TYPE_VAAPI, scaleFilter: "scale_vaapi" },
    vulkan: { deviceType: AV_HWDEVICE_TYPE_VULKAN, scaleFilter: "scale_vulkan" },
    nvenc: { deviceType: AV_HWDEVICE_TYPE_CUDA, scaleFilter: "scale_cuda" },
    cuda: { deviceType: AV_HWDEVICE_TYPE_CUDA, scaleFilter: "scale_cuda" },
    qsv: { deviceType: AV_HWDEVICE_TYPE_QSV, scaleFilter: "scale_qsv" },
    videotoolbox: {
        deviceType: AV_HWDEVICE_TYPE_VIDEOTOOLBOX,
        scaleFilter: "scale_vt",
    },
    amf: { deviceType: AV_HWDEVICE_TYPE_AMF, scaleFilter: "vpp_amf" },
    d3d12va: {
        deviceType: AV_HWDEVICE_TYPE_D3D12VA,
        scaleFilter: "scale_d3d12",
    },
};
export function hardwareForEncoder(name) {
    const suffix = name.split("_").at(-1);
    return (suffix && hardwareBySuffix[suffix]) || null;
}
import { amf } from "./amf.js";
import { d3d12va } from "./d3d12va.js";
import { merge } from "./merge.js";
import { nvenc } from "./nvenc.js";
import { qsv } from "./qsv.js";
import { software } from "./software.js";
import { v4l2m2m } from "./v4l2m2m.js";
import { vaapi } from "./vaapi.js";
import { videotoolbox } from "./videotoolbox.js";
const Encoders = {
    software,
    nvenc,
    vaapi,
    qsv,
    videotoolbox,
    amf,
    v4l2m2m,
    d3d12va,
    merge,
};
export { Encoders };
//# sourceMappingURL=index.js.map