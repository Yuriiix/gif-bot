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
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== CONFIG ===================== */
const MAX_SIZE = 7 * 1024 * 1024;

/* ===================== HELPERS ===================== */
function runFFmpeg(input, output, fps, width) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-t",
        "6",
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,
        "-loop",
        "0",
        "-preset",
        "veryfast",
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

/* ===================== MESSAGE ===================== */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const attachment = message.attachments.first();
  if (!attachment) return;
  if (!attachment.contentType?.startsWith("video/")) return;

  /* ===================== MODE DETECTION ===================== */
  const content = message.content.toLowerCase();

  let mode = "fast"; // default safe mode

  if (content.includes("hd")) mode = "hd";
  if (content.includes("fast")) mode = "fast";

  let fps, width;

  if (mode === "hd") {
    fps = 24;
    width = 720;
  } else {
    fps = 14;
    width = 480;
  }

  await message.reply(`Converting video... (${mode.toUpperCase()} mode)`);

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

    /* ===================== CONVERSION LOOP ===================== */
    let attempts = 0;

    while (attempts < 3) {
      try {
        await runFFmpeg(input, output, fps, width);
      } catch (err) {
        console.log("FFmpeg error:", err);
        break;
      }

      const size = fs.existsSync(output) ? fs.statSync(output).size : 0;

      if (size && size <= MAX_SIZE) break;

      // fallback reduce quality
      if (mode === "hd") {
        width -= 120;
        fps -= 2;
      } else {
        width -= 80;
        fps -= 2;
      }

      if (width < 320) break;

      if (fs.existsSync(output)) fs.unlinkSync(output);
      attempts++;
    }

    /* ===================== SEND RESULT ===================== */
    if (!fs.existsSync(output)) {
      await message.reply("Conversion failed.");
      return;
    }

    try {
      await message.reply({ files: [output] });
    } catch (err) {
      console.log("Upload error:", err);
      await message.reply("Failed to upload GIF (too large or Discord error).");
    }
  } catch (err) {
    console.log("General error:", err);
    await message.reply("Something went wrong during conversion.");
  } finally {
    if (fs.existsSync(input)) fs.unlinkSync(input);
    if (fs.existsSync(output)) fs.unlinkSync(output);
  }
});

/* ===================== EXPRESS ===================== */
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== LOGIN ===================== */
client.login(TOKEN);
