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

/* ===================== STATE (IMPORTANT) ===================== */

let processing = false;

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

function deleteFile(file) {
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

      const writer = fs.createWriteStream(path);

      res.data.pipe(writer);

      writer.on("finish", resolve);
      writer.on("error", reject);
      res.data.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

/* ===================== HIGH QUALITY GIF ===================== */

function convertGif(input, output) {
  const palette = `palette-${Date.now()}.png`;

  return new Promise((resolve, reject) => {
    // STEP 1: palette (QUALITY FIX)
    ffmpeg(input)
      .outputOptions([
        "-vf",
        "fps=12,scale=480:-1:flags=lanczos,palettegen"
      ])
      .save(palette)
      .on("end", () => {

        // STEP 2: apply palette
        ffmpeg(input)
          .input(palette)
          .outputOptions([
            "-vf",
            "fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer",
            "-loop",
            "0"
          ])
          .format("gif")
          .on("end", () => {
            deleteFile(palette);
            resolve();
          })
          .on("error", (err) => {
            deleteFile(palette);
            reject(err);
          })
          .save(output);
      })
      .on("error", (err) => {
        deleteFile(palette);
        reject(err);
      });
  });
}

/* ===================== MESSAGE ===================== */

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (processing) return;

  const file = message.attachments.first();
  if (!file || !file.contentType?.startsWith("video/")) return;

  processing = true;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  let statusMsg;

  try {
    statusMsg = await message.reply("Converting video...");

    await download(file.url, input);

    await convertGif(input, output);

    const sizeMB = fs.statSync(output).size / 1024 / 1024;

    if (sizeMB > 7.5) {
      await message.reply("GIF too large for Discord.");
      return;
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.error("ERROR:", err);
    await message.reply("Conversion failed.");
  } finally {
    processing = false;
    deleteFile(input);
    deleteFile(output);
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
