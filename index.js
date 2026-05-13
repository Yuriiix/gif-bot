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

/* ===================== STATE ===================== */
let busy = false;

/* ===================== EXPRESS ===================== */

app.get("/", (_, res) => res.send("Bot alive"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

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

/* ===================== SAFE GIF CONVERSION ===================== */

function convertToGif(input, output) {
  return new Promise((resolve, reject) => {

    const command = ffmpeg(input)
      .outputOptions([
        "-vf",
        // SIMPLE + SAFE FILTER (NO BROKEN COMPLEX CHAINS)
        "fps=12,scale=480:-1:flags=lanczos",

        "-loop", "0",
      ])
      .outputFormat("gif")
      .on("start", cmd => {
        console.log("FFmpeg started:", cmd);
      })
      .on("stderr", line => {
        console.log("FFmpeg:", line);
      })
      .on("error", err => {
        console.log("FFmpeg ERROR:", err.message);
        reject(err);
      })
      .on("end", () => {
        console.log("FFmpeg done");
        resolve();
      })
      .save(output);

    // safety kill (prevents hanging on bad videos)
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
  if (busy) return;

  const file = message.attachments.first();
  if (!file) return;

  const isVideo =
    file.contentType?.startsWith("video/") ||
    /\.(mp4|mov|webm|mkv|avi)$/i.test(file.url);

  if (!isVideo) return;

  busy = true;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    await message.reply("Converting video...");

    await download(file.url, input);

    await convertToGif(input, output);

    if (!fs.existsSync(output)) {
      return message.reply("Conversion failed (no output file).");
    }

    const sizeMB = fs.statSync(output).size / 1024 / 1024;

    if (sizeMB > 7.5) {
      return message.reply("GIF too large for Discord.");
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error("FULL ERROR:", err);
    await message.reply("Conversion failed (check logs).");
  } finally {
    busy = false;
    clean(input);
    clean(output);
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
