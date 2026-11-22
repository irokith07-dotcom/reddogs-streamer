export declare class BitrateCalculator {
    private readonly _windowDurationMs;
    private readonly _samples;
    private _totalBytes;
    constructor(windowDurationMs?: number);
    addSample(bytes: number): number;
    calculateBitrate(): number;
}
