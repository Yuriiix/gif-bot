const express = require("express");
const app = express();

const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

const fs = require("fs");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

/* ===================== DISCORD ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TOKEN = process.env.TOKEN;

/* ===================== EXPRESS ===================== */

app.get("/", (_, res) => {
  res.send("Bot alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const DISCORD_LIMIT_MB = 7.8;

/* ===================== HELPERS ===================== */

function fileSizeMB(path) {
  return fs.statSync(path).size / 1024 / 1024;
}

function deleteFile(path) {
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}

function runFFmpeg(input, output, fps, width) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos`,

        "-loop", "0",

        // better gif compression
        "-gifflags", "-offsetting",

        // speed + stability
        "-preset", "veryfast",
        "-threads", "2",
      ])
      .format("gif")
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

/* ===================== MESSAGE EVENT ===================== */

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    const attachment = message.attachments.first();

    if (
      !attachment ||
      !attachment.contentType?.startsWith("video/")
    ) {
      return;
    }

    await message.reply("Converting video to GIF...");

    const id = Date.now();

    const input = `./input-${id}.mp4`;
    const output = `./output-${id}.gif`;

    /* ===================== DOWNLOAD ===================== */

    const response = await axios({
      url: attachment.url,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024,
    });

    const writer = fs.createWriteStream(input);

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    /* ===================== QUALITY PRESETS ===================== */

    const presets = [
      { fps: 20, width: 640 },
      { fps: 18, width: 560 },
      { fps: 16, width: 480 },
      { fps: 14, width: 420 },
      { fps: 12, width: 360 },
    ];

    let success = false;

    for (const preset of presets) {
      deleteFile(output);

      console.log(
        `Trying ${preset.fps}fps @ ${preset.width}px`
      );

      await runFFmpeg(
        input,
        output,
        preset.fps,
        preset.width
      );

      if (!fs.existsSync(output)) {
        continue;
      }

      const size = fileSizeMB(output);

      console.log(`GIF Size: ${size.toFixed(2)}MB`);

      if (size <= DISCORD_LIMIT_MB) {
        success = true;
        break;
      }
    }

    /* ===================== RESULT ===================== */

    if (!success) {
      await message.reply(
        "Video is too large to safely convert into a Discord GIF."
      );

      return;
    }

    await message.reply({
      files: [output],
    });

    console.log("GIF sent successfully");

    /* ===================== CLEANUP ===================== */

    deleteFile(input);
    deleteFile(output);

  } catch (err) {
    console.error(err);

    await message.reply(
      "Conversion failed."
    );
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
