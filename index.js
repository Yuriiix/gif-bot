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

/* ===================== STATE (FIXED) ===================== */

const processing = new Set();

/* ===================== HELPERS ===================== */

function clean(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
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
      .then(res => {
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

function convertToGif(input, output) {
  const palette = `palette-${Date.now()}.png`;

  return new Promise((resolve, reject) => {

    // STEP 1: palette generation
    ffmpeg(input)
      .outputOptions([
        "-vf",
        "fps=18,scale=480:-1:flags=lanczos,palettegen=max_colors=256"
      ])
      .save(palette)
      .on("end", () => {

        // STEP 2: apply palette
        ffmpeg(input)
          .input(palette)
          .outputOptions([
            "-vf",
            "fps=18,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=floyd_steinberg",
            "-loop",
            "0"
          ])
          .outputFormat("gif")
          .on("end", () => {
            clean(palette);
            resolve();
          })
          .on("error", err => {
            clean(palette);
            reject(err);
          })
          .save(output);

      })
      .on("error", err => {
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
  if (!file || !file.contentType?.startsWith("video/")) {
    processing.delete(message.id);
    return;
  }

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  let replied = false;

  try {
    await message.reply("Converting video...");
    replied = true;

    await download(file.url, input);

    await convertToGif(input, output);

    if (!fs.existsSync(output)) {
      await message.reply("Conversion failed (no output file).");
      return;
    }

    const sizeMB = fs.statSync(output).size / 1024 / 1024;

    if (sizeMB > 7.5) {
      await message.reply("GIF too large for Discord.");
      return;
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error("ERROR:", err);

    if (replied) {
      await message.reply("Conversion failed.");
    }
  } finally {
    processing.delete(message.id);
    clean(input);
    clean(output);
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
