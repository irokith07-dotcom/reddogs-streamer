/**
 * Hardware encoders are only implemented for a subset of platforms, and ffmpeg
 * simply doesn't build e.g. videotoolbox outside of macOS. Encoder getters check
 * the running platform and throw, rather than silently providing no settings, so
 * the user gets told the platform is the problem instead of a confusing libav
 * error about a missing encoder.
 */
export declare function assertPlatformSupported(encoder: string, ...platforms: NodeJS.Platform[]): void;
