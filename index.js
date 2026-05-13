const express = require("express");
const app = express();

const { Client, GatewayIntentBits } = require("discord.js");
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

app.get("/", (_, res) => res.send("Bot alive"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const MAX_MB = 7.5;
let busy = false; // prevents crashes from multiple conversions

/* ===================== HELPERS ===================== */

function clean(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function run(cmd) {
  return new Promise((resolve, reject) => {
    cmd.on("end", resolve).on("error", reject);
  });
}

/* ===================== CORE CONVERSION ===================== */

async function convertGif(input, output) {
  const palette = `palette-${Date.now()}.png`;

  // STEP 1: create palette (fixes pixel/noise issues)
  await run(
    ffmpeg(input)
      .outputOptions([
        "-vf",
        "fps=15,scale=480:-1:flags=lanczos,palettegen"
      ])
      .save(palette)
  );

  // STEP 2: apply palette (high quality GIF)
  await run(
    ffmpeg(input)
      .input(palette)
      .outputOptions([
        "-vf",
        "fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
        "-loop",
        "0",
      ])
      .save(output)
  );

  clean(palette);
}

/* ===================== MESSAGE ===================== */

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (busy) return message.reply("Bot is busy, try again in a moment.");

  const file = message.attachments.first();
  if (!file) return;

  const isVideo =
    file.contentType?.startsWith("video/") ||
    file.url.match(/\.(mp4|mov|webm|mkv|avi)$/i);

  if (!isVideo) return;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    busy = true;

    await message.reply("Converting video...");

    /* ================= DOWNLOAD ================= */

    const res = await axios({
      url: file.url,
      method: "GET",
      responseType: "stream",
      timeout: 60000,
    });

    const writer = fs.createWriteStream(input);
    res.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    /* ================= CONVERT ================= */

    await convertGif(input, output);

    if (!fs.existsSync(output)) {
      return message.reply("Conversion failed.");
    }

    /* ================= SIZE CHECK ================= */

    const sizeMB = fs.statSync(output).size / 1024 / 1024;

    if (sizeMB > MAX_MB) {
      return message.reply(
        "GIF too large. Try a shorter or lower-motion video."
      );
    }

    /* ================= SEND ================= */

    await message.reply({ files: [output] });

  } catch (err) {
    console.error(err);
    await message.reply("Conversion failed.");
  } finally {
    busy = false;
    clean(input);
    clean(output);
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
