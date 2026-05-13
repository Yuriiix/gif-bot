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

/* ===================== HELPERS ===================== */

function deleteFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {}
}

/* ===================== SAFE DOWNLOAD ===================== */

async function downloadFile(url, path) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 120000,
    maxBodyLength: Infinity,
  });

  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(path);

    res.data.pipe(stream);

    stream.on("finish", resolve);
    stream.on("error", reject);
    res.data.on("error", reject);
  });
}

/* ===================== HIGH QUALITY GIF (STABLE) ===================== */

function convertToGif(input, output, fps, width) {
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
      .outputFormat("gif")
      .on("start", cmd => console.log("FFmpeg:", cmd))
      .on("error", err => {
        console.error("FFmpeg ERROR:", err.message);
        reject(err);
      })
      .on("end", resolve)
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
    /\.(mp4|mov|webm|mkv|avi)$/i.test(file.url);

  if (!isVideo) return;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    await message.reply("Converting video...");

    /* DOWNLOAD */
    await downloadFile(file.url, input);

    /* SMART SETTINGS (safe + stable) */
    const sizeMB = (file.size || 5) / 1024 / 1024;

    let fps = 15;
    let width = 540;

    if (sizeMB > 8) {
      fps = 12;
      width = 480;
    }

    if (sizeMB > 15) {
      fps = 10;
      width = 420;
    }

    /* CONVERT */
    await convertToGif(input, output, fps, width);

    if (!fs.existsSync(output)) {
      return message.reply("Conversion failed (no output file).");
    }

    const outMB = fs.statSync(output).size / 1024 / 1024;

    if (outMB > MAX_MB) {
      return message.reply("GIF too large for Discord.");
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error("FULL ERROR:", err);
    await message.reply("Conversion failed. Check bot logs.");
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
});

client.login(TOKEN);
