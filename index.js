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

app.get("/", (_, res) => {
  res.send("Bot alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const MAX_MB = 7.5;

const activeJobs = new Set();

/* ===================== HELPERS ===================== */

function clean(file) {
  try {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {}
}

async function download(url, path) {

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 120000,
  });

  return new Promise((resolve, reject) => {

    const writer = fs.createWriteStream(path);

    response.data.pipe(writer);

    writer.on("finish", resolve);
    writer.on("error", reject);

    response.data.on("error", reject);

  });
}

/* ===================== GIF CREATION ===================== */

function makeGif(input, output, fps, width) {

  return new Promise((resolve, reject) => {

    const command = ffmpeg(input)

      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos`,

        "-loop",
        "0",

        "-threads",
        "2",
      ])

      .outputFormat("gif")

      .on("end", resolve)

      .on("error", reject)

      .save(output);

    /* prevent hanging */

    setTimeout(() => {
      try {
        command.kill("SIGKILL");
      } catch {}
    }, 60000);

  });
}

/* ===================== MESSAGE ===================== */

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  if (activeJobs.has(message.id)) return;

  const file = message.attachments.first();

  if (!file) return;

  const isVideo =
    file.contentType?.startsWith("video/") ||
    /\.(mp4|mov|webm|mkv|avi)$/i.test(file.url);

  if (!isVideo) return;

  activeJobs.add(message.id);

  const id = Date.now();

  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {

    await message.reply("Converting video...");

    /* ---------- DOWNLOAD ---------- */

    await download(file.url, input);

    /* ---------- SMART QUALITY PRESETS ---------- */

    const presets = [
      { fps: 20, width: 540 },
      { fps: 18, width: 480 },
      { fps: 15, width: 420 },
      { fps: 12, width: 360 },
      { fps: 10, width: 320 },
    ];

    let success = false;

    for (const preset of presets) {

      clean(output);

      console.log(
        `Trying ${preset.width}px @ ${preset.fps}fps`
      );

      await makeGif(
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
        `GIF Size: ${sizeMB.toFixed(2)}MB`
      );

      if (sizeMB <= MAX_MB) {
        success = true;
        break;
      }
    }

    /* ---------- FAILED ---------- */

    if (!success) {

      await message.reply(
        "Video too large for Discord GIF limits."
      );

      return;
    }

    /* ---------- SEND ---------- */

    await message.reply({
      files: [output],
    });

  } catch (err) {

    console.error(err);

    await message.reply(
      "Conversion failed."
    );

  } finally {

    activeJobs.delete(message.id);

    clean(input);
    clean(output);

  }

});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
