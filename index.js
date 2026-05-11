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
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {}
}

/* ===================== HIGH QUALITY GIF ===================== */

function runFFmpeg(input, output, fps, width) {
  return new Promise((resolve, reject) => {

    const palette = `./palette-${Date.now()}.png`;

    /* ---------- STEP 1: GENERATE PALETTE ---------- */

    ffmpeg(input)
      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=256`,
      ])
      .save(palette)
      .on("end", () => {

        /* ---------- STEP 2: CREATE GIF ---------- */

        ffmpeg(input)
          .input(palette)
          .complexFilter([
            `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`
          ])
          .outputOptions([
            "-loop", "0",

            // better compression
            "-gifflags", "-offsetting",

            // stability
            "-preset", "veryfast",
            "-threads", "2",
          ])
          .format("gif")
          .save(output)

          .on("end", () => {
            deleteFile(palette);
            resolve();
          })

          .on("error", (err) => {
            deleteFile(palette);
            reject(err);
          });

      })

      .on("error", (err) => {
        deleteFile(palette);
        reject(err);
      });

  });
}

/* ===================== MESSAGE EVENT ===================== */

client.on("messageCreate", async (message) => {

  let input = null;
  let output = null;

  try {
    if (message.author.bot) return;

    const attachment = message.attachments.first();

    if (
      !attachment ||
      !attachment.contentType?.startsWith("video/")
    ) {
      return;
    }

    await message.reply(
      "Converting video to high-quality GIF..."
    );

    const id = Date.now();

    input = `./input-${id}.mp4`;
    output = `./output-${id}.gif`;

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
      response.data.on("error", reject);
    });

    /* ===================== QUALITY PRESETS ===================== */

    const presets = [
      { fps: 20, width: 720 },
      { fps: 18, width: 640 },
      { fps: 16, width: 560 },
      { fps: 14, width: 480 },
      { fps: 12, width: 420 },
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

      console.log(
        `GIF Size: ${size.toFixed(2)}MB`
      );

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

  } catch (err) {

    console.error(err);

    await message.reply(
      "Conversion failed."
    );

  } finally {

    deleteFile(input);
    deleteFile(output);

  }

});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
