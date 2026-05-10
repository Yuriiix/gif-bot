const express = require("express");
const app = express();

const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

/* ===================== DISCORD CLIENT ===================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TOKEN = process.env.TOKEN;

/* ===================== READY ===================== */
client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== EXPRESS ===================== */
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== HELPERS ===================== */
function runFFmpeg(input, output, fps, width) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-t", "5", // prevents long conversions freezing server

        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos`,

        "-loop", "0",
        "-preset", "veryfast",
        "-threads", "2"
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

/* ===================== MESSAGE EVENT ===================== */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const attachment = message.attachments.first();
  if (!attachment) return;
  if (!attachment.contentType?.startsWith("video/")) return;

  await message.reply("Converting video...");

  const id = Date.now();
  const input = `./input-${id}.mp4`;
  const output = `./output-${id}.gif`;

  try {
    /* ===================== DOWNLOAD ===================== */
    const response = await axios({
      url: attachment.url,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(input);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
      response.data.on("error", reject);
    });

    /* ===================== SMART QUALITY SYSTEM ===================== */
    const sizeMB = (attachment.size || 0) / 1024 / 1024;

    let fps = 16;
    let width = 480;

    if (sizeMB < 3) {
      fps = 18;
      width = 560;
    } else if (sizeMB > 8) {
      fps = 12;
      width = 360;
    }

    console.log(`Converting: ${fps}fps | ${width}px | ${sizeMB.toFixed(2)}MB`);

    /* ===================== CONVERT ===================== */
    await runFFmpeg(input, output, fps, width);

    if (!fs.existsSync(output)) {
      await message.reply("Conversion failed.");
      return;
    }

    const outSizeMB = fs.statSync(output).size / 1024 / 1024;

    console.log(`Output size: ${outSizeMB.toFixed(2)}MB`);

    if (outSizeMB > 7) {
      await message.reply("GIF too large for Discord (try shorter video).");
      return;
    }

    await message.reply({ files: [output] });

  } catch (err) {
    console.log("Error:", err);
    await message.reply("Something went wrong during conversion.");
  } finally {
    if (fs.existsSync(input)) fs.unlinkSync(input);
    if (fs.existsSync(output)) fs.unlinkSync(output);
  }
});

/* ===================== LOGIN ===================== */
client.login(TOKEN);
