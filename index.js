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

app.get("/", (_, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const MAX_MB = 7.5;
const active = new Set();

/* ===================== CLEAN ===================== */

function clean(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

/* ===================== DOWNLOAD ===================== */

async function download(url, path) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 120000,
  });

  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(path);

    res.data.pipe(stream);

    stream.on("finish", resolve);
    stream.on("error", reject);
    res.data.on("error", reject);
  });
}

/* ===================== GIF CONVERT (STABLE + HIGH QUALITY) ===================== */

function convertGif(input, output, fps, width) {
  return new Promise((resolve, reject) => {
    const palette = `palette-${Date.now()}.png`;

    // STEP 1: palette
    ffmpeg(input)
      .outputOptions([
        `-vf fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`
      ])
      .save(palette)
      .on("end", () => {

        // STEP 2: gif
        ffmpeg(input)
          .input(palette)
          .outputOptions([
            `-vf fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
            "-loop 0"
          ])
          .format("gif")
          .save(output)
          .on("end", () => {
            clean(palette);
            resolve();
          })
          .on("error", (err) => {
            clean(palette);
            reject(err);
          });

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
  if (active.has(message.id)) return;

  const file = message.attachments.first();
  if (!file || !file.contentType?.startsWith("video/")) return;

  active.add(message.id);

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    await message.reply("Converting video...");

    await download(file.url, input);

    // SMART QUALITY (prevents Discord overflow)
    const sizeMB = (file.size || 5) / 1024 / 1024;

    let fps = 18;
    let width = 640;

    if (sizeMB > 4) {
      fps = 15;
      width = 540;
    }

    if (sizeMB > 8) {
      fps = 12;
      width = 480;
    }

    if (sizeMB > 15) {
      fps = 10;
      width = 420;
    }

    await convertGif(input, output, fps, width);

    if (!fs.existsSync(output)) {
      return message.reply("Conversion failed (no output).");
    }

    const outMB = fs.statSync(output).size / 1024 / 1024;

    if (outMB > MAX_MB) {
      return message.reply("GIF too large for Discord even after compression.");
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error(err);
    await message.reply("Conversion failed.");
  } finally {
    active.delete(message.id);
    clean(input);
    clean(output);
  }
});

client.login(TOKEN);
