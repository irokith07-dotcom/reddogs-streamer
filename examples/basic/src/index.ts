import fs from "node:fs";
import path from "node:path";
import { Client, StageChannel, type Message } from "@lng2004/discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream } from "@dank074/discord-video-stream";
import config from "./config.json" with {type: "json"};

const streamer = new Streamer(new Client());

// ready event
streamer.client.on("ready", () => {
    console.log(`--- ${streamer.client.user?.tag} is ready ---`);
});

let controller: AbortController;

// message event
streamer.client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (!config.acceptedAuthors.includes(msg.author.id)) return;

    const content = msg.content?.trim() || "";

    if (content.startsWith("$play-live")) {
        const args = parseArgs(content, msg);
        if (!args) {
            console.log("No valid URL or file found for $play-live");
            return;
        }

        const channel = msg.author.voice?.channel;

        if(!channel) {
            console.log("Author is not in a voice channel");
            return;
        }

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        await streamer.joinVoice(msg.guildId!, channel.id);

        if (channel instanceof StageChannel)
        {
            await streamer.client.user?.voice?.setSuppressed(false);
        }

        controller?.abort();
        controller = new AbortController();

        console.log(`Preparing stream for: ${args.url}`);
        const { output, promise } = await prepareStream(args.url, {
            width: config.streamOpts.width,
            height: config.streamOpts.height,
            frameRate: config.streamOpts.fps,
            bitrateVideo: config.streamOpts.bitrateKbps,
            bitrateVideoMax: config.streamOpts.maxBitrateKbps,
            videoCodec: Utils.normalizeVideoCodec(config.streamOpts.videoCodec)
        }, controller.signal);
        promise.catch((err) => {
            console.log("An error happened while preparing the stream");
            console.log(err);
        });
        await playStream(output, streamer, undefined, controller.signal)
            .catch((err) => {
                console.log("playStream error or aborted:", err?.message || err);
                controller.abort();
            });

        console.log("Finished playing video");
    } else if (content.startsWith("$play-cam")) {
        const args = parseArgs(content, msg);
        if (!args) {
            console.log("No valid URL or file found for $play-cam");
            return;
        }

        const channel = msg.author.voice?.channel;

        if (!channel) {
            console.log("Author is not in a voice channel");
            return;
        }

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        await streamer.joinVoice(msg.guildId!, channel.id);

        if (channel instanceof StageChannel)
        {
            await streamer.client.user?.voice?.setSuppressed(false);
        }

        controller?.abort();
        controller = new AbortController();

        console.log(`Preparing cam stream for: ${args.url}`);
        const { output, promise } = await prepareStream(args.url, {
            width: config.streamOpts.width,
            height: config.streamOpts.height,
            frameRate: config.streamOpts.fps,
            bitrateVideo: config.streamOpts.bitrateKbps,
            bitrateVideoMax: config.streamOpts.maxBitrateKbps,
            videoCodec: Utils.normalizeVideoCodec(config.streamOpts.videoCodec)
        }, controller.signal);
        promise.catch((err) => {
            console.log("An error happened while preparing the stream");
            console.log(err);
        });
        await playStream(output, streamer, undefined, controller.signal)
            .catch((err) => {
                console.log("playStream error or aborted:", err?.message || err);
                controller.abort();
            });

        console.log("Finished playing video");
    } else if (content.startsWith("$disconnect")) {
        controller?.abort();
        streamer.leaveVoice();
        console.log("Disconnected from voice channel");
    } else if(content.startsWith("$stop-stream")) {
        controller?.abort();
        console.log("Stream stopped");
    }
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled promise rejection:", err);
});
process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});

// login
streamer.client.login(config.token);

function resolveMediaSource(input?: string, attachmentUrl?: string): string | undefined {
    if (attachmentUrl) return attachmentUrl;
    if (!input) return;

    if (input.startsWith("http://") || input.startsWith("https://")) {
        return input;
    }

    let cleaned = input.trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
    }

    const candidatePaths = [
        cleaned,
        path.resolve(process.cwd(), cleaned),
        path.resolve(process.cwd(), "examples/basic", cleaned),
        path.resolve(process.cwd(), "../..", cleaned),
        path.resolve("D:/Discord-Tools/Discord-video-stream-master", cleaned),
        path.resolve("D:/Discord-Tools/Discord-video-stream-master/examples/basic", cleaned)
    ];

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return cleaned;
}

function parseArgs(message: string, msg?: Message): Args | undefined {
    const attachmentUrl = msg?.attachments?.first()?.url;
    const parts = message.trim().split(/\s+/);
    let rawUrl: string | undefined = undefined;

    if (parts.length >= 2) {
        rawUrl = message.slice(message.indexOf(parts[0]) + parts[0].length).trim();
    }

    const resolved = resolveMediaSource(rawUrl, attachmentUrl);
    if (!resolved) return;

    return { url: resolved };
}

type Args = {
    url: string;
}
