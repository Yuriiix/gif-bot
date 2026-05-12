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

/* ===================== HELPERS ===================== */

const wait = (r, j) =>
  (err) => (err ? j(err) : r());

function safeDelete(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

/* ===================== FFmpeg ===================== */

function convertGif(input, output, fps, width) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos`,
        "-loop",
        "0",
        "-preset",
        "veryfast",
        "-threads",
        "2",
      ])
      .format("gif")
      .on("end", resolve)
      .on("error", reject)
      .save(output);
  });
}

/* ===================== MESSAGE ===================== */

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

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
    await message.reply("Converting video...");

    /* ===================== DOWNLOAD ===================== */

    const res = await axios({
      url: file.url,
      method: "GET",
      responseType: "stream",
      timeout: 60000,
    });

    const writer = fs.createWriteStream(input);
    res.data.pipe(writer);

    await new Promise(wait(writer.once.bind(writer, "finish")));

    /* ===================== SMART SETTINGS ===================== */

    const sizeMB = file.size / 1024 / 1024;

    let fps = 15;
    let width = 540;

    if (sizeMB > 5) {
      fps = 12;
      width = 480;
    }

    if (sizeMB > 10) {
      fps = 10;
      width = 420;
    }

    /* ===================== CONVERT ===================== */

    await convertGif(input, output, fps, width);

    if (!fs.existsSync(output)) {
      await message.reply("Conversion failed.");
      return;
    }

    const outSize = fs.statSync(output).size / 1024 / 1024;

    if (outSize > MAX_MB) {
      await message.reply("Video too large for Discord GIF limits.");
      return;
    }

    await message.reply({
      files: [output],
    });

  } catch (err) {
    console.error(err);
    await message.reply("Conversion failed.");
  } finally {
    safeDelete(input);
    safeDelete(output);
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
