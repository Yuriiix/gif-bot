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

/* ===================== CONFIG ===================== */
const MAX_SIZE = 7 * 1024 * 1024;

/* ===================== FFMPEG ===================== */
function runFFmpeg(input, output, fps, width) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,

        "-loop",
        "0",
        "-preset",
        "veryfast",
        "-threads",
        "2"
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

    /* ===================== SMART START SETTINGS ===================== */
    const fileSizeMB = (attachment.size || 0) / 1024 / 1024;

    let fps, width;

    if (fileSizeMB < 3) {
      fps = 20;
      width = 640;
    } else if (fileSizeMB < 8) {
      fps = 16;
      width = 520;
    } else {
      fps = 12;
      width = 420;
    }

    /* ===================== SINGLE OPTIMIZED RUN ===================== */
    await runFFmpeg(input, output, fps, width);

    const size = fs.existsSync(output)
      ? fs.statSync(output).size
      : 0;

    /* ===================== AUTO DOWNGRADE ONCE (NOT LOOP SPAM) ===================== */
    if (size > MAX_SIZE) {
      fs.unlinkSync(output);

      fps = Math.max(10, fps - 4);
      width = Math.max(320, width - 120);

      await runFFmpeg(input, output, fps, width);
    }

    /* ===================== SEND GIF ===================== */
    if (!fs.existsSync(output)) {
      await message.reply("Conversion failed.");
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

/* ===================== EXPRESS ===================== */
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== LOGIN ===================== */
client.login(TOKEN);
