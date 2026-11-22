import type { EncoderSettingsGetter } from "./index.js";
type D3D12VASettings = {
    /**
     * Index of the D3D12 adapter to use, as reported by the Windows display
     * adapter ordering. Leave unset to use the system default adapter.
     */
    device?: string;
};
export declare function d3d12va({ device }?: Partial<D3D12VASettings>): EncoderSettingsGetter;
export {};
