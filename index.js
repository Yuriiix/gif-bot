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
const processing = new Set();

/* ===================== HELPERS ===================== */

function deleteFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ===================== DOWNLOAD (ROBUST) ===================== */

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

/* ===================== SAFE FFmpeg ===================== */

function convertToGif(input, output, fps, width) {
  return new Promise((resolve, reject) => {

    const command = ffmpeg(input)
      .outputOptions([
        // high stability GIF pipeline
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos`,

        "-loop",
        "0",

        // prevents broken encodes
        "-gifflags",
        "-offsetting",

        "-threads",
        "2",
      ])
      .outputFormat("gif")
      .on("start", cmd => console.log("FFmpeg started"))
      .on("error", err => {
        console.error("FFmpeg error:", err.message);
        reject(err);
      })
      .on("end", () => {
        console.log("FFmpeg done");
        resolve();
      })
      .save(output);

    // safety kill (prevents infinite hangs)
    setTimeout(() => {
      try {
        command.kill("SIGKILL");
      } catch {}
    }, 120000);
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

  if (processing.has(message.id)) return;
  processing.add(message.id);

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    await message.reply("Converting video...");

    await downloadFile(file.url, input);

    const sizeMB = (file.size || 5) / 1024 / 1024;

    /* ===================== STRICT DISCORD SAFE SETTINGS ===================== */
    let fps = 12;
    let width = 480;

    if (sizeMB < 5) {
      fps = 15;
      width = 540;
    } else if (sizeMB > 10) {
      fps = 10;
      width = 420;
    }

    await convertToGif(input, output, fps, width);

    if (!fs.existsSync(output)) {
      return message.reply("Conversion failed (no output).");
    }

    const outMB = fs.statSync(output).size / 1024 / 1024;

    if (outMB > MAX_MB) {
      return message.reply("GIF too large for Discord even after compression.");
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error("ERROR:", err);
    await message.reply("Conversion failed (ffmpeg or download error).");
  } finally {
    processing.delete(message.id);
    deleteFile(input);
    deleteFile(output);
  }
});

client.login(TOKEN);
