const express = require("express");
const app = express();

const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

/* ===================== BOT ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TOKEN = process.env.TOKEN;

/* ===================== EXPRESS ===================== */

app.get("/", (_, res) => res.send("Bot alive"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== STATE ===================== */

const processing = new Set();

/* ===================== HELPERS ===================== */

function clean(file) {
  try {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {}
}

function download(url, path) {
  return new Promise((resolve, reject) => {
    axios({
      url,
      method: "GET",
      responseType: "stream",
      timeout: 120000,
    })
      .then((res) => {
        const stream = fs.createWriteStream(path);

        res.data.pipe(stream);

        stream.on("finish", resolve);
        stream.on("error", reject);
        res.data.on("error", reject);
      })
      .catch(reject);
  });
}

/* ===================== HIGH QUALITY GIF ===================== */

function convertToGif(input, output, fps, width) {
  const palette = `palette-${Date.now()}.png`;

  return new Promise((resolve, reject) => {

    /* ---------- PALETTE ---------- */

    ffmpeg(input)
      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`
      ])
      .save(palette)

      .on("end", () => {

        /* ---------- GIF ---------- */

        ffmpeg(input)
          .input(palette)

          .complexFilter([
            `fps=${fps},scale=${width}:-1:flags=lanczos[x]`,
            "[x][1:v]paletteuse=dither=sierra2_4a"
          ])

          .outputOptions([
            "-loop",
            "0"
          ])

          .outputFormat("gif")

          .on("end", () => {
            clean(palette);
            resolve();
          })

          .on("error", (err) => {
            clean(palette);
            reject(err);
          })

          .save(output);

      })

      .on("error", (err) => {
        clean(palette);
        reject(err);
      });

  });
}

/* ===================== MESSAGE ===================== */

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  if (processing.has(message.id)) return;
  processing.add(message.id);

  const file = message.attachments.first();

  const isVideo =
    file &&
    (
      file.contentType?.startsWith("video/") ||
      /\.(mp4|mov|webm|mkv|avi)$/i.test(file.url)
    );

  if (!isVideo) {
    processing.delete(message.id);
    return;
  }

  const id = Date.now();

  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {

    await message.reply("Converting video...");

    /* ---------- DOWNLOAD ---------- */

    await download(file.url, input);

    /* ---------- AUTO QUALITY SYSTEM ---------- */

    const presets = [
      { fps: 15, width: 480 },
      { fps: 12, width: 420 },
      { fps: 10, width: 360 },
      { fps: 8, width: 320 },
    ];

    let success = false;

    for (const preset of presets) {

      clean(output);

      console.log(
        `Trying ${preset.width}px @ ${preset.fps}fps`
      );

      await convertToGif(
        input,
        output,
        preset.fps,
        preset.width
      );

      if (!fs.existsSync(output)) {
        continue;
      }

      const sizeMB =
        fs.statSync(output).size / 1024 / 1024;

      console.log(
        `Result: ${sizeMB.toFixed(2)}MB`
      );

      if (sizeMB <= 7.5) {
        success = true;
        break;
      }
    }

    /* ---------- FAILED ---------- */

    if (!success) {

      await message.reply(
        "Video too large to convert into a Discord-safe GIF."
      );

      return;
    }

    /* ---------- SEND ---------- */

    await message.reply({
      files: [output],
    });

  } catch (err) {

    console.error("ERROR:", err);

    await message.reply(
      "Conversion failed."
    );

  } finally {

    processing.delete(message.id);

    clean(input);
    clean(output);

  }

});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
