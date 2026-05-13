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
app.listen(process.env.PORT || 3000);

/* ===================== STATE ===================== */

let busy = false;

/* ===================== HELPERS ===================== */

const clean = (f) => {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
};

const download = (url, path) =>
  axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 120000,
  }).then(res => {
    const stream = fs.createWriteStream(path);
    res.data.pipe(stream);

    return new Promise((resv, rej) => {
      stream.on("finish", resv);
      stream.on("error", rej);
    });
  });

/* ===================== FFmpeg (HIGH QUALITY + FAST) ===================== */

function convertGif(input, output, fps, width) {
  const palette = `palette-${Date.now()}.png`;

  return new Promise((resolve, reject) => {
    // STEP 1: palette (quality boost)
    ffmpeg(input)
      .outputOptions([
        `-vf fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`
      ])
      .save(palette)
      .on("end", () => {

        // STEP 2: gif encode
        ffmpeg(input)
          .input(palette)
          .outputOptions([
            "-lavfi",
            `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a`,
            "-loop 0"
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
  if (message.author.bot || busy) return;

  const file = message.attachments.first();
  if (!file || !file.contentType?.startsWith("video/")) return;

  busy = true;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {
    await download(file.url, input);

    const sizeMB = (file.size || 5) / 1024 / 1024;

    // balanced presets (quality + speed + Discord safe)
    let fps = 15;
    let width = 540;

    if (sizeMB > 5) {
      fps = 13;
      width = 480;
    }
    if (sizeMB > 10) {
      fps = 10;
      width = 420;
    }

    await convertGif(input, output, fps, width);

    if (!fs.existsSync(output)) {
      return message.reply("Conversion failed.");
    }

    const outMB = fs.statSync(output).size / 1024 / 1024;

    if (outMB > 7.5) {
      return message.reply("GIF too large for Discord.");
    }

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

client.login(TOKEN);
