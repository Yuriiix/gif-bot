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

/* ===================== STATE LOCK ===================== */
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
  return new Promise(async (resolve, reject) => {
    try {
      const res = await axios({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 120000,
      });

      const stream = fs.createWriteStream(path);

      res.data.pipe(stream);

      stream.on("finish", resolve);
      stream.on("error", reject);
      res.data.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

/* ===================== GIF CONVERSION (PROPER PIPELINE) ===================== */

function convertToGif(input, output) {
  const palette = `palette-${Date.now()}.png`;

  return new Promise((resolve, reject) => {

    // STEP 1: palette generation (quality fix)
    ffmpeg(input)
      .outputOptions([
        "-vf",
        "fps=12,scale=480:-1:flags=lanczos,palettegen"
      ])
      .save(palette)
      .on("end", () => {

        // STEP 2: apply palette (final GIF)
        ffmpeg(input)
          .input(palette)
          .outputOptions([
            "-vf",
            "fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a",
            "-loop",
            "0"
          ])
          .format("gif")
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
  if (busy) return;

  const file = message.attachments.first();
  if (!file || !file.contentType?.startsWith("video/")) return;

  busy = true;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    await message.reply("Converting video to GIF...");

    await download(file.url, input);

    await convertToGif(input, output);

    const sizeMB = fs.statSync(output).size / 1024 / 1024;

    if (sizeMB > 7.5) {
      await message.reply("GIF too large for Discord limit.");
      return;
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error("ERROR:", err);
    await message.reply("Conversion failed.");
  } finally {
    busy = false;
    clean(input);
    clean(output);
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
