export class BitrateCalculator {
    _windowDurationMs;
    _samples = [];
    _totalBytes = 0;
    constructor(windowDurationMs = 1000) {
        this._windowDurationMs = windowDurationMs;
    }
    addSample(bytes) {
        const now = Date.now();
        this._samples.push({ timestampMs: now, bytes });
        this._totalBytes += bytes;
        const cutoff = now - this._windowDurationMs;
        let expired = 0;
        while (expired < this._samples.length &&
            this._samples[expired].timestampMs < cutoff) {
            this._totalBytes -= this._samples[expired].bytes;
            expired++;
        }
        if (expired > 0)
            this._samples.splice(0, expired);
        return this.calculateBitrate();
    }
    calculateBitrate() {
        return (this._totalBytes * 8 * 1000) / this._windowDurationMs;
    }
}
//# sourceMappingURL=BitrateCalculator.js.map